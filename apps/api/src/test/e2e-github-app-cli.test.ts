import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { githubApps } from '../db/schema.ts';
import { testEnv } from './fixtures.ts';
import { createTestDatabase, type TestDatabase } from './test-database.ts';

const CLI = fileURLToPath(new URL('e2e-github-app-cli.ts', import.meta.url));
const Output = z.object({ clientId: z.string(), created: z.boolean() });

describe('e2e:github-app', () => {
  let database: TestDatabase;

  function run(args: string[] = []) {
    const env = testEnv({ DATABASE_URL: database.url });
    return execa(process.execPath, [CLI, ...args], {
      env: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value)])),
    });
  }

  const clientIds = async () =>
    (await database.db.select({ clientId: githubApps.clientId }).from(githubApps)).map(
      (row) => row.clientId,
    );

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(() => database.drop());

  it('keeps an existing App, and removes only the e2e App', async () => {
    const kept = Output.parse(JSON.parse((await run()).stdout));
    await run(['--remove']);

    expect(kept).toEqual({ clientId: 'test-github-client-id', created: false });
    expect(await clientIds()).toEqual(['test-github-client-id']);
  });

  it('creates the e2e App when none exists, and --remove deletes it again', async () => {
    await database.db.delete(githubApps);

    const created = Output.parse(JSON.parse((await run()).stdout));
    const again = Output.parse(JSON.parse((await run()).stdout));
    await run(['--remove']);

    expect(created).toEqual({ clientId: 'e2e-github-client-id', created: true });
    expect(again.created).toBe(false);
    expect(await clientIds()).toEqual([]);
  }, 30_000);
});
