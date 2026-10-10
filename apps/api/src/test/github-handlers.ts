import { http, HttpResponse, type HttpHandler } from 'msw';
import { z } from 'zod';
import { blobSha, type FakePullRequest, type GithubState } from './fake-github-state.ts';

const API = 'https://api.github.com';

const TokenBody = z.object({
  repository_ids: z.array(z.int()).optional(),
  permissions: z.record(z.string(), z.string()).optional(),
});
const CreatePullBody = z.object({
  title: z.string(),
  body: z.string(),
  head: z.string(),
  base: z.string(),
});
const UpdatePullBody = z.object({ body: z.string() });

const notFound = () =>
  HttpResponse.json(
    { message: 'Not Found', documentation_url: 'https://docs.github.com/rest' },
    { status: 404 },
  );

const bearer = (request: Request) =>
  request.headers.get('authorization')?.replace(/^(token|bearer) /i, '') ?? '';

/** Every folder on the way to each path, as GitHub's recursive tree lists them. */
function folders(paths: string[]): string[] {
  const all = new Set<string>();
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1);
    parts.forEach((_, index) => all.add(parts.slice(0, index + 1).join('/')));
  }
  return [...all];
}

async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  return text === '' ? {} : JSON.parse(text);
}

/**
 * GitHub's REST API for the endpoints the adapter calls, over the state a test sets. Each
 * response carries the fields the adapter reads, in GitHub's shape. A repository route answers
 * only a token scoped to that repository.
 */
export function githubHandlers(state: GithubState): HttpHandler[] {
  const byId = (id: number) => state.repositories.find((repository) => repository.id === id);

  function scopedRepository(request: Request, owner: unknown, name: unknown) {
    const repository = state.repositories.find(
      (candidate) => candidate.owner === owner && candidate.name === name,
    );
    const token = state.tokens.get(bearer(request));
    return repository !== undefined && token?.repositoryId === repository.id
      ? repository
      : undefined;
  }

  function pullJson(pull: FakePullRequest) {
    const repository = byId(pull.repositoryId);
    return {
      number: pull.number,
      html_url: `https://github.com/${repository?.owner}/${repository?.name}/pull/${pull.number}`,
      state: pull.state,
      merged_at: pull.merged ? '2026-10-08T12:00:00Z' : null,
      title: pull.title,
      body: pull.body,
      head: { ref: pull.head },
      base: { ref: pull.base },
    };
  }

  function findPull(request: Request, params: Record<string, unknown>) {
    const repository = scopedRepository(request, params['owner'], params['repo']);
    return state.pullRequests.find(
      (pull) => pull.repositoryId === repository?.id && pull.number === Number(params['number']),
    );
  }

  return [
    http.all(`${API}/*`, ({ request }) => {
      const path = new URL(request.url).pathname;
      const failure = state.failures.find(
        (rule) => rule.remaining > 0 && rule.pathPattern.test(path),
      );
      if (failure === undefined) return undefined;
      failure.remaining -= 1;
      failure.hits += 1;
      return HttpResponse.json(
        { message: failure.message, documentation_url: 'https://docs.github.com/rest' },
        { status: failure.status, headers: failure.headers },
      );
    }),
    http.post(`${API}/app-manifests/:code/conversions`, ({ params }) => {
      const app = state.manifestConversions.get(String(params['code']));
      if (app === undefined) return notFound();
      return HttpResponse.json(
        {
          id: app.id,
          slug: app.slug,
          node_id: 'A_kwDOfake',
          name: app.slug,
          owner: { login: app.ownerLogin, id: 1, type: 'User' },
          client_id: app.clientId,
          client_secret: app.clientSecret,
          webhook_secret: null,
          pem: app.pem,
          html_url: `https://github.com/apps/${app.slug}`,
        },
        { status: 201 },
      );
    }),
    http.get(`${API}/app/installations`, () => {
      const ids = [...new Set(state.repositories.map((repository) => repository.installationId))];
      return HttpResponse.json(
        ids.map((id) => ({ id, account: { login: `account-${id}` }, app_id: 1 })),
      );
    }),
    http.post(`${API}/app/installations/:id/access_tokens`, async ({ request, params }) => {
      const installationId = Number(params['id']);
      const body = TokenBody.parse(await jsonBody(request));
      const repositoryIds = body.repository_ids ?? [];
      const permissions = body.permissions ?? {};
      state.tokenRequests.push({
        appJwt: bearer(request),
        installationId,
        repositoryIds,
        permissions,
      });
      const token = `ghs_fake_${state.tokens.size + 1}`;
      state.tokens.set(token, {
        installationId,
        repositoryId: repositoryIds.length === 1 ? (repositoryIds[0] ?? null) : null,
      });
      return HttpResponse.json(
        {
          token,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
          permissions,
          repository_selection: 'selected',
        },
        { status: 201 },
      );
    }),
    http.get(`${API}/installation/repositories`, ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? '30');
      const installationId = state.tokens.get(bearer(request))?.installationId;
      const reachable = state.repositories.filter(
        (repository) => repository.installationId === installationId,
      );
      const headers: Record<string, string> = {};
      if (page * perPage < reachable.length) {
        url.searchParams.set('page', String(page + 1));
        headers['link'] = `<${url.toString()}>; rel="next"`;
      }
      return HttpResponse.json(
        {
          total_count: reachable.length,
          repositories: reachable.slice((page - 1) * perPage, page * perPage).map((repository) => ({
            id: repository.id,
            name: repository.name,
            owner: { login: repository.owner },
            private: repository.private,
            default_branch: repository.defaultBranch,
          })),
        },
        { headers },
      );
    }),
    http.get(`${API}/repositories/:id`, ({ request, params }) => {
      const repository = byId(Number(params['id']));
      if (repository === undefined) return notFound();
      if (state.tokens.get(bearer(request))?.repositoryId !== repository.id) return notFound();
      return HttpResponse.json({
        id: repository.id,
        name: repository.name,
        owner: { login: repository.owner },
        default_branch: repository.defaultBranch,
      });
    }),
    http.get(`${API}/repos/:owner/:repo/commits/:ref`, ({ request, params }) => {
      const repository = scopedRepository(request, params['owner'], params['repo']);
      if (repository === undefined || params['ref'] !== repository.defaultBranch) return notFound();
      return HttpResponse.json({
        sha: repository.commit,
        commit: { tree: { sha: `tree-${repository.commit}` } },
      });
    }),
    http.get(`${API}/repos/:owner/:repo/git/trees/:sha`, ({ request, params }) => {
      const repository = scopedRepository(request, params['owner'], params['repo']);
      if (repository === undefined || params['sha'] !== `tree-${repository.commit}`) {
        return notFound();
      }
      const paths = Object.keys(repository.files).toSorted();
      return HttpResponse.json({
        sha: params['sha'],
        truncated: repository.truncated,
        tree: [
          ...folders(paths).map((path) => ({
            path,
            mode: '040000',
            type: 'tree',
            sha: blobSha(path),
          })),
          ...paths.map((path) => {
            const text = repository.files[path] ?? '';
            return {
              path,
              mode: '100644',
              type: 'blob',
              sha: blobSha(text),
              size: repository.sizes[path] ?? Buffer.byteLength(text),
            };
          }),
        ],
      });
    }),
    http.get(`${API}/repos/:owner/:repo/git/blobs/:sha`, ({ request, params }) => {
      const repository = scopedRepository(request, params['owner'], params['repo']);
      const text = Object.values(repository?.files ?? {}).find(
        (candidate) => blobSha(candidate) === params['sha'],
      );
      if (text === undefined) return notFound();
      state.blobReads.push(String(params['sha']));
      return HttpResponse.json({
        sha: params['sha'],
        encoding: 'base64',
        content: Buffer.from(text).toString('base64'),
        size: Buffer.byteLength(text),
      });
    }),
    http.get(`${API}/repos/:owner/:repo/pulls`, ({ request, params }) => {
      const repository = scopedRepository(request, params['owner'], params['repo']);
      if (repository === undefined) return notFound();
      const url = new URL(request.url);
      const head = url.searchParams.get('head');
      const wanted = url.searchParams.get('state') ?? 'open';
      return HttpResponse.json(
        state.pullRequests
          .filter(
            (pull) =>
              pull.repositoryId === repository.id &&
              `${repository.owner}:${pull.head}` === head &&
              pull.state === wanted,
          )
          .map(pullJson),
      );
    }),
    http.post(`${API}/repos/:owner/:repo/pulls`, async ({ request, params }) => {
      const repository = scopedRepository(request, params['owner'], params['repo']);
      if (repository === undefined) return notFound();
      const pull: FakePullRequest = {
        number: state.pullRequests.length + 1,
        repositoryId: repository.id,
        state: 'open',
        merged: false,
        ...CreatePullBody.parse(await jsonBody(request)),
      };
      state.pullRequests.push(pull);
      return HttpResponse.json(pullJson(pull), { status: 201 });
    }),
    http.patch(`${API}/repos/:owner/:repo/pulls/:number`, async ({ request, params }) => {
      const pull = findPull(request, params);
      if (pull === undefined) return notFound();
      pull.body = UpdatePullBody.parse(await jsonBody(request)).body;
      return HttpResponse.json(pullJson(pull));
    }),
    http.get(`${API}/repos/:owner/:repo/pulls/:number`, ({ request, params }) => {
      const pull = findPull(request, params);
      return pull === undefined ? notFound() : HttpResponse.json(pullJson(pull));
    }),
  ];
}
