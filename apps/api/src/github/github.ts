import { GITHUB_FAILED_MESSAGE_MAX, type InstallableRepository } from '@plangineer/contracts';
import { App, Octokit, RequestError } from 'octokit';
import type { Logger } from '../logger.ts';
import type { GithubAppCredentials, GithubAppStore } from './github-app-store.ts';

/** A failed GitHub call, with GitHub's status and message. It never holds a token or the key. */
export class GithubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message.slice(0, GITHUB_FAILED_MESSAGE_MAX));
    this.name = 'GithubError';
    this.status = status;
  }
}

/** A repository the App reaches, by its stable ids and its current owner and name. */
export interface GithubRepository {
  installationId: number;
  repositoryId: number;
  owner: string;
  name: string;
}

export type GithubInstallableRepository = InstallableRepository & { defaultBranch: string };

export interface RepositoryInfo {
  repositoryId: number;
  owner: string;
  name: string;
  defaultBranch: string;
}

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size: number | null;
}

export interface Tree {
  commit: string;
  entries: TreeEntry[];
  truncated: boolean;
}

export interface PullRequest {
  number: number;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
}

export interface NewPullRequest {
  title: string;
  body: string;
  head: string;
  base: string;
}

type Permission = 'contents' | 'pull_requests';
type Access = 'read' | 'write';

/** Blob reads run this many at a time, so a scan never floods GitHub. */
const BLOB_CONCURRENCY = 8;

/**
 * Octokit's own retry and throttling, with a small budget: some calls run under a setup row lock,
 * which D36 bounds to a few seconds. A transient 5xx is retried twice, about 2.5 s in all, and a
 * rate limit fails at once with GitHub's status instead of waiting it out.
 */
const GithubOctokit = Octokit.defaults({
  retry: { retries: 2, retryAfterBaseValue: 500 },
  throttle: { onRateLimit: () => false, onSecondaryRateLimit: () => false },
});

function toGithubError(error: unknown): GithubError {
  if (error instanceof GithubError) return error;
  if (error instanceof RequestError) return new GithubError(error.status, error.message);
  throw error;
}

/** Runs a GitHub call, turning any failure GitHub reports into a GithubError. */
async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toGithubError(error);
  }
}

function toPullRequest(data: {
  number: number;
  html_url: string;
  state: string;
  merged_at: string | null;
}): PullRequest {
  return {
    number: data.number,
    url: data.html_url,
    state: data.state === 'open' ? 'open' : 'closed',
    merged: data.merged_at !== null,
  };
}

async function readBlob(client: Octokit, repository: GithubRepository, sha: string) {
  const { data } = await client.request('GET /repos/{owner}/{repo}/git/blobs/{file_sha}', {
    owner: repository.owner,
    repo: repository.name,
    file_sha: sha,
  });
  return Buffer.from(data.content, 'base64').toString('utf8');
}

/**
 * The GitHub App adapter: the only module that talks to GitHub. The Octokit App is built from the
 * stored App on first use, and again after the stored App changes. No signed-in path reaches it
 * before the App exists, since sign-in needs the App.
 */
export function createGithub({ appStore, logger }: { appStore: GithubAppStore; logger: Logger }) {
  const log = logger.child({ component: 'github' });
  const LoggedOctokit = GithubOctokit.defaults({
    log: {
      debug: () => {},
      info: () => {},
      warn: (message: string) => log.warn({ message }, 'GitHub client warning'),
      error: (message: string) => log.error({ message }, 'GitHub client error'),
    },
  });
  let built: { credentials: GithubAppCredentials; app: App } | undefined;

  async function currentApp(): Promise<App> {
    const credentials = await appStore.get();
    if (credentials === null) throw new Error('GitHub App is not configured');
    if (built?.credentials !== credentials) {
      const app = new App({
        appId: credentials.appId,
        privateKey: credentials.privateKey,
        Octokit: LoggedOctokit,
      });
      built = { credentials, app };
    }
    return built.app;
  }

  /** A client whose token reaches one repository with one permission, minted per action. */
  async function scopedClient(
    repository: Pick<GithubRepository, 'installationId' | 'repositoryId'>,
    permission: Permission,
    access: Access,
  ) {
    const app = await currentApp();
    const { data } = await app.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      {
        installation_id: repository.installationId,
        repository_ids: [repository.repositoryId],
        permissions: { [permission]: access },
      },
    );
    return new GithubOctokit({ auth: data.token });
  }

  return {
    /** Every repository each installation of the App reaches. */
    listInstallableRepositories: () =>
      call(async () => {
        const repositories: GithubInstallableRepository[] = [];
        const app = await currentApp();
        for await (const { installation, octokit } of app.eachInstallation.iterator()) {
          const items = await octokit.paginate('GET /installation/repositories', {
            per_page: 100,
          });
          for (const item of items) {
            repositories.push({
              installationId: installation.id,
              githubRepositoryId: item.id,
              owner: item.owner.login,
              name: item.name,
              private: item.private,
              defaultBranch: item.default_branch,
            });
          }
        }
        return repositories;
      }),

    getRepository: (installationId: number, repositoryId: number) =>
      call(async (): Promise<RepositoryInfo> => {
        const client = await scopedClient({ installationId, repositoryId }, 'contents', 'read');
        const { data } = await client.request('GET /repositories/{repository_id}', {
          repository_id: repositoryId,
        });
        return {
          repositoryId: data.id,
          owner: data.owner.login,
          name: data.name,
          defaultBranch: data.default_branch,
        };
      }),

    /** The whole tree at a branch or commit, with the commit it resolved to. */
    readTree: (repository: GithubRepository, ref: string) =>
      call(async (): Promise<Tree> => {
        const client = await scopedClient(repository, 'contents', 'read');
        const { data: commit } = await client.request('GET /repos/{owner}/{repo}/commits/{ref}', {
          owner: repository.owner,
          repo: repository.name,
          ref,
        });
        const { data } = await client.request('GET /repos/{owner}/{repo}/git/trees/{tree_sha}', {
          owner: repository.owner,
          repo: repository.name,
          tree_sha: commit.commit.tree.sha,
          recursive: 'true',
        });
        return {
          commit: commit.sha,
          truncated: data.truncated,
          entries: data.tree.flatMap((entry) =>
            entry.path === undefined || entry.sha === undefined
              ? []
              : [
                  {
                    path: entry.path,
                    sha: entry.sha,
                    type:
                      entry.type === 'tree' ? 'tree' : entry.type === 'commit' ? 'commit' : 'blob',
                    size: entry.size ?? null,
                  },
                ],
          ),
        };
      }),

    /** The text of each blob, keyed by its sha. */
    readBlobs: (repository: GithubRepository, shas: readonly string[]) =>
      call(async () => {
        const client = await scopedClient(repository, 'contents', 'read');
        const unique = [...new Set(shas)];
        const texts = new Map<string, string>();
        for (let start = 0; start < unique.length; start += BLOB_CONCURRENCY) {
          const batch = unique.slice(start, start + BLOB_CONCURRENCY);
          const read = await Promise.all(batch.map((sha) => readBlob(client, repository, sha)));
          batch.forEach((sha, index) => texts.set(sha, read[index] ?? ''));
        }
        return texts;
      }),

    findOpenPullRequest: (repository: GithubRepository, branch: string) =>
      call(async (): Promise<PullRequest | null> => {
        const client = await scopedClient(repository, 'pull_requests', 'read');
        const { data } = await client.request('GET /repos/{owner}/{repo}/pulls', {
          owner: repository.owner,
          repo: repository.name,
          head: `${repository.owner}:${branch}`,
          state: 'open',
          per_page: 1,
        });
        const [first] = data;
        return first === undefined ? null : toPullRequest(first);
      }),

    createPullRequest: (repository: GithubRepository, pullRequest: NewPullRequest) =>
      call(async () => {
        const client = await scopedClient(repository, 'pull_requests', 'write');
        const { data } = await client.request('POST /repos/{owner}/{repo}/pulls', {
          owner: repository.owner,
          repo: repository.name,
          ...pullRequest,
        });
        return toPullRequest(data);
      }),

    updatePullRequestBody: (repository: GithubRepository, number: number, body: string) =>
      call(async () => {
        const client = await scopedClient(repository, 'pull_requests', 'write');
        const { data } = await client.request('PATCH /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: repository.owner,
          repo: repository.name,
          pull_number: number,
          body,
        });
        return toPullRequest(data);
      }),

    getPullRequest: (repository: GithubRepository, number: number) =>
      call(async () => {
        const client = await scopedClient(repository, 'pull_requests', 'read');
        const { data } = await client.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
          owner: repository.owner,
          repo: repository.name,
          pull_number: number,
        });
        return toPullRequest(data);
      }),
  };
}

export type Github = ReturnType<typeof createGithub>;
