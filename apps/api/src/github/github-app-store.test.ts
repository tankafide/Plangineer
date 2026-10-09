import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { githubApps } from '../db/schema.ts';
import { TEST_APP_PRIVATE_KEY, testEnv } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { testGithubApp } from '../test/test-github-app.ts';
import { createGithubAppStore } from './github-app-store.ts';

const SECRET = testEnv().BETTER_AUTH_SECRET;

describe('createGithubAppStore', () => {
  let database: TestDatabase;
  const store = (secret = SECRET) => createGithubAppStore({ db: database.db, secret });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(githubApps);
  });

  afterAll(async () => {
    await database.drop();
  });

  it('answers null with no stored App', async () => {
    expect(await store().get()).toBeNull();
  });

  it('saves an App that a new store reads back decrypted', async () => {
    const app = testGithubApp(TEST_APP_PRIVATE_KEY);

    expect(await store().save(app)).toBe('saved');
    expect(await store().get()).toEqual(app);
  });

  it('answers exists for a second App, keeping the first', async () => {
    const first = testGithubApp(TEST_APP_PRIVATE_KEY);
    await store().save(first);

    expect(await store().save({ ...first, appId: 9, slug: 'other' })).toBe('exists');
    expect(await store().get()).toEqual(first);
  });

  it('reads again while nothing is cached, so an App saved elsewhere is seen', async () => {
    const reader = store();
    expect(await reader.get()).toBeNull();

    await store().save(testGithubApp(TEST_APP_PRIVATE_KEY));

    expect((await reader.get())?.slug).toBe('plangineer-test');
  });

  it('fails naming BETTER_AUTH_SECRET when the App does not decrypt', async () => {
    await store().save(testGithubApp(TEST_APP_PRIVATE_KEY));

    await expect(store('another-secret-that-is-at-least-32-characters').get()).rejects.toThrow(
      'The stored GitHub App cannot be decrypted. BETTER_AUTH_SECRET changed since the App was created.',
    );
  });
});
