import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGithubAppStore } from '../github/github-app-store.ts';
import type { Env } from '../env.ts';
import { TEST_APP_PRIVATE_KEY, testEnv } from '../test/fixtures.ts';
import { createEmptyTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { testGithubApp } from '../test/test-github-app.ts';
import { createDatabase } from './client.ts';

const RESET_SCRIPT = fileURLToPath(new URL('reset.ts', import.meta.url));

/** Works on the database through its own pool, ended before the reset drops it. */
async function withDatabase<T>(
  url: string,
  work: (store: ReturnType<typeof createGithubAppStore>) => Promise<T>,
) {
  const { db, pool } = createDatabase(url);
  try {
    return await work(createGithubAppStore({ db, secret: testEnv().BETTER_AUTH_SECRET }));
  } finally {
    await pool.end();
  }
}

describe('db:reset', () => {
  let logDir: string;

  beforeAll(async () => {
    logDir = await mkdtemp(path.join(os.tmpdir(), 'db-reset-'));
  });

  afterAll(() => rm(logDir, { recursive: true, force: true, maxRetries: 5 }));

  function runReset(overrides: Partial<Env>) {
    const env = testEnv({ API_LOG_FILE: path.join(logDir, 'api.log'), ...overrides });
    return execa(process.execPath, [RESET_SCRIPT], {
      env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])),
      reject: false,
    });
  }

  it('refuses a DATABASE_URL whose host is not local, before connecting', async () => {
    const result = await runReset({
      DATABASE_URL: 'postgres://plangineer:plangineer@db.example.com:5432/plangineer',
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('db:reset refuses a DATABASE_URL whose host is not local');
  });

  describe('on a local database', () => {
    let database: TestDatabase;

    beforeAll(async () => {
      database = await createEmptyTestDatabase();
    });

    afterAll(() => database.drop());

    it('succeeds on a database with no github_apps table, then keeps a stored App', async () => {
      expect((await runReset({ DATABASE_URL: database.url })).exitCode).toBe(0);
      expect(await withDatabase(database.url, (store) => store.get())).toBeNull();
      const app = testGithubApp(TEST_APP_PRIVATE_KEY);
      await withDatabase(database.url, (store) => store.save(app));

      const result = await runReset({ DATABASE_URL: database.url });

      expect(result.exitCode).toBe(0);
      expect(await withDatabase(database.url, (store) => store.get())).toEqual(app);
    }, 30_000);
  });
});
