import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { sessionCookie, storeUser } from '../test/fixtures.ts';
import { DEFAULT_ROLE_SETTINGS, storeRepository } from '../test/setup-fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

/** Procedures over HTTP, as the web client calls them, so error data is seen on the wire. */
describe('RPC over HTTP', () => {
  let database: TestDatabase;
  let fake: FakeGithub;
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;
  let adminId: string;
  let nextGithubId = 0;

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
    testApp = await createTestApp(database);
    const admin = await storeUser(testApp.auth, { role: 'admin' });
    adminId = admin.id;
    cookie = await sessionCookie(testApp.auth, admin.id);
  });

  afterAll(async () => {
    await testApp.close();
    fake.close();
    await database.drop();
  });

  function post(path: string, input: unknown) {
    return testApp.app.request(`/rpc/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'orpc', cookie },
      body: JSON.stringify({ json: input }),
    });
  }

  it('sends GITHUB_FAILED with GitHub status and message as the error data', async () => {
    fake.repositories.push(fakeRepository());
    fake.fail(/\/installation\/repositories/, 500, 'Server Error');

    const response = await post('repository/listInstallable', undefined);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      json: {
        defined: true,
        code: 'GITHUB_FAILED',
        data: { status: 500, message: expect.stringContaining('Server Error') },
      },
    });
  });

  it.each([
    [
      'an unknown agent',
      {
        roleSettings: {
          ...DEFAULT_ROLE_SETTINGS,
          planning: { ...DEFAULT_ROLE_SETTINGS.planning, agent: 'codex' },
        },
      },
    ],
    ['an unknown run mode', { defaultRunMode: 'autopilot' }],
  ])('refuses an update with %s', async (_name, change) => {
    const repositoryId = await storeRepository(database.db, {
      createdBy: adminId,
      githubRepositoryId: (nextGithubId += 1),
    });

    const response = await post('repository/update', { repositoryId, ...change });

    expect(response.status).toBe(400);
  });
});
