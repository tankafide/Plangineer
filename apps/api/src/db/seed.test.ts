import { fileURLToPath } from 'node:url';
import { asc, count } from 'drizzle-orm';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { testEnv } from '../test/fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import {
  features,
  repositories,
  repositorySetups,
  runEvents,
  runners,
  runs,
  user,
} from './schema.ts';
import { seedDatabase } from './seed.ts';

const SESSION_CLI = fileURLToPath(new URL('../test/e2e-session-cli.ts', import.meta.url));
const TABLES = { user, runners, repositories, repositorySetups, runs, runEvents, features };

async function counts(database: TestDatabase) {
  const entries = await Promise.all(
    Object.entries(TABLES).map(async ([name, table]) => {
      const [row] = await database.db.select({ n: count() }).from(table);
      return [name, row?.n ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

describe('seedDatabase', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('holds no seeded row in a database the test template builds', async () => {
    expect(await counts(database)).toEqual({
      user: 0,
      runners: 0,
      repositories: 0,
      repositorySetups: 0,
      runs: 0,
      runEvents: 0,
      features: 0,
    });
  });

  it('stores the users, runner, repositories and one setup per status, no feature, and adds nothing on a second run', async () => {
    await seedDatabase(database.db);
    const first = await counts(database);
    await seedDatabase(database.db);

    expect(first).toEqual({
      user: 2,
      runners: 1,
      repositories: 8,
      repositorySetups: 6,
      runs: 4,
      runEvents: 1 + 4 + 5 + 5,
      features: 0,
    });
    expect(await counts(database)).toEqual(first);
    const statuses = await database.db
      .select({ status: repositorySetups.status })
      .from(repositorySetups);
    expect(statuses.map((row) => row.status).toSorted()).toEqual([
      'complete',
      'failed',
      'generating',
      'pr_open',
      'scanned',
      'scanned',
    ]);
  });

  it('gives every repository the main branch, acme/app included, and the three default run modes', async () => {
    await seedDatabase(database.db);

    const rows = await database.db
      .select({
        name: repositories.name,
        defaultBranch: repositories.defaultBranch,
        defaultRunMode: repositories.defaultRunMode,
      })
      .from(repositories)
      .orderBy(asc(repositories.name));

    expect(rows.every((row) => row.defaultBranch === 'main')).toBe(true);
    expect(rows.map((row) => row.name)).toContain('app');
    expect(
      Object.fromEntries(
        rows
          .filter((row) => ['web-app', 'api-complete', 'api-scanned', 'app'].includes(row.name))
          .map((row) => [row.name, row.defaultRunMode]),
      ),
    ).toEqual({
      'web-app': 'manual',
      'api-complete': 'manual_plan',
      'api-scanned': 'auto_loop',
      app: 'manual',
    });
  });

  it('prints a session cookie for a seeded user that the API resolves', async () => {
    await seedDatabase(database.db);
    const env = testEnv({ DATABASE_URL: database.url });
    const result = await execa(process.execPath, [SESSION_CLI, '--user', 'seed-admin'], {
      env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])),
    });
    const cookie = z
      .object({ name: z.string(), value: z.string() })
      .parse(JSON.parse(result.stdout));
    const { app, close } = await createTestApp(database);

    const response = await app.request('/rpc/me/get', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'orpc',
        cookie: `${cookie.name}=${cookie.value}`,
      },
      body: '{}',
    });
    await close();

    expect(await response.json()).toMatchObject({
      json: { name: 'Seed Admin', role: 'admin' },
    });
  });
});
