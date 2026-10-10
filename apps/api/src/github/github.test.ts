import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { blobSha, fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { TEST_APP_PRIVATE_KEY, silentLogger, testEnv } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { githubApps } from '../db/schema.ts';
import type { Logger } from '../logger.ts';
import { createGithubAppStore } from './github-app-store.ts';
import { createGithub, GithubError, type GithubRepository } from './github.ts';

const REPOSITORY: GithubRepository = {
  installationId: 1,
  repositoryId: 1001,
  owner: 'acme',
  name: 'app',
};

describe('createGithub', () => {
  let fake: FakeGithub;
  let database: TestDatabase;
  let github: ReturnType<typeof createGithub>;

  /** GitHub over the App stored in the test database. */
  function githubWith(logger: Logger) {
    const appStore = createGithubAppStore({
      db: database.db,
      secret: testEnv().BETTER_AUTH_SECRET,
    });
    return createGithub({ appStore, logger });
  }

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
    github = githubWith(silentLogger);
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  it('lists every repository of every installation with its default branch, across pages', async () => {
    for (let index = 0; index < 120; index += 1) {
      fake.repositories.push(
        fakeRepository({ installationId: 1, id: 2000 + index, name: `repo-${index}` }),
      );
    }
    fake.repositories.push(
      fakeRepository({ installationId: 2, id: 9000, owner: 'beta', defaultBranch: 'trunk' }),
    );

    const repositories = await github.listInstallableRepositories();

    expect(repositories).toHaveLength(121);
    expect(repositories).toContainEqual({
      installationId: 2,
      githubRepositoryId: 9000,
      owner: 'beta',
      name: 'app',
      private: true,
      defaultBranch: 'trunk',
    });
  });

  it('reads a repository with a token scoped to it and contents read', async () => {
    fake.repositories.push(fakeRepository({ defaultBranch: 'trunk' }));

    const repository = await github.getRepository(1, 1001);

    expect(repository).toEqual({
      repositoryId: 1001,
      owner: 'acme',
      name: 'app',
      defaultBranch: 'trunk',
    });
    expect(fake.tokenRequests).toEqual([
      {
        appJwt: expect.any(String),
        installationId: 1,
        repositoryIds: [1001],
        permissions: { contents: 'read' },
      },
    ]);
  });

  it('reads the tree at the branch head and the blobs by sha', async () => {
    const files = { 'README.md': '# App', 'src/index.ts': 'export {};' };
    fake.repositories.push(fakeRepository({ files }));

    const tree = await github.readTree(REPOSITORY, 'main');
    const blobs = await github.readBlobs(REPOSITORY, [blobSha('# App'), blobSha('export {};')]);

    expect(tree.commit).toBe('c'.repeat(40));
    expect(tree.truncated).toBe(false);
    expect(tree.entries).toContainEqual({
      path: 'src/index.ts',
      type: 'blob',
      sha: blobSha('export {};'),
      size: 10,
    });
    expect(tree.entries).toContainEqual(expect.objectContaining({ path: 'src', type: 'tree' }));
    expect(blobs).toEqual(
      new Map([
        [blobSha('# App'), '# App'],
        [blobSha('export {};'), 'export {};'],
      ]),
    );
  });

  it('creates, finds, updates and reads a pull request with pull request tokens', async () => {
    fake.repositories.push(fakeRepository());
    const pull = { title: 'Set up', body: 'One', head: 'plangineer/setup', base: 'main' };

    const created = await github.createPullRequest(REPOSITORY, pull);
    const found = await github.findOpenPullRequest(REPOSITORY, 'plangineer/setup');
    await github.updatePullRequestBody(REPOSITORY, created.number, 'Two');
    const read = await github.getPullRequest(REPOSITORY, created.number);

    expect(created).toEqual({
      number: 1,
      url: 'https://github.com/acme/app/pull/1',
      state: 'open',
      merged: false,
    });
    expect(found).toEqual(created);
    expect(read).toEqual(created);
    expect(fake.pullRequests[0]?.body).toBe('Two');
    expect(fake.tokenRequests.map((request) => request.permissions)).toEqual([
      { pull_requests: 'write' },
      { pull_requests: 'read' },
      { pull_requests: 'write' },
      { pull_requests: 'read' },
    ]);
    expect(fake.tokenRequests.every((request) => request.repositoryIds.join() === '1001')).toBe(
      true,
    );
  });

  it('finds no open pull request for a branch with none', async () => {
    fake.repositories.push(fakeRepository());

    expect(await github.findOpenPullRequest(REPOSITORY, 'plangineer/setup')).toBeNull();
  });

  it.each([
    [404, 'Not Found', {}, 1],
    [403, 'API rate limit exceeded', { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }, 1],
    [500, 'Server Error', {}, 3],
  ])('turns a %i from GitHub into a GithubError', async (status, message, headers, attempts) => {
    fake.repositories.push(fakeRepository());
    const rule = fake.fail(/\/repos\/acme\/app\/commits\//, status, message, { headers });

    const error = await github.readTree(REPOSITORY, 'main').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GithubError);
    expect(error).toMatchObject({ status, message: expect.stringContaining(message) });
    expect(rule.hits).toBe(attempts);
  });

  it('retries a transient 5xx and returns the result', async () => {
    fake.repositories.push(fakeRepository());
    fake.fail(/\/repos\/acme\/app\/commits\//, 502, 'Bad Gateway', { times: 1 });

    const tree = await github.readTree(REPOSITORY, 'main');

    expect(tree.commit).toBe('c'.repeat(40));
  });

  it('logs no token or key when GitHub fails', async () => {
    const lines: string[] = [];
    const logger = pino(
      { level: 'trace' },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );
    const logged = githubWith(logger);
    fake.repositories.push(fakeRepository());
    fake.fail(/\/repos\//, 500, 'Server Error');

    const error = await logged.readTree(REPOSITORY, 'main').catch((caught: unknown) => caught);

    const output = [...lines, String(error), JSON.stringify(error)].join('\n');
    expect(output).not.toContain('ghs_fake_');
    expect(output).not.toContain(TEST_APP_PRIVATE_KEY.split('\n')[1]);
  });

  it('fails with no stored App, without calling GitHub', async () => {
    const empty = await createTestDatabase();
    try {
      await empty.db.delete(githubApps);
      const appStore = createGithubAppStore({ db: empty.db, secret: testEnv().BETTER_AUTH_SECRET });
      const unconfigured = createGithub({ appStore, logger: silentLogger });

      await expect(unconfigured.getRepository(1, 1001)).rejects.toThrow(
        'GitHub App is not configured',
      );
      expect(fake.tokenRequests).toEqual([]);
    } finally {
      await empty.drop();
    }
  }, 30_000);
});
