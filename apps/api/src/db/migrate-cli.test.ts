import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEmptyTestDatabase, type TestDatabase } from '../test/test-database.ts';

const MIGRATE_SCRIPT = fileURLToPath(new URL('migrate-cli.ts', import.meta.url));

function runMigrate(env: Record<string, string>) {
  return execa(process.execPath, [MIGRATE_SCRIPT], { env, extendEnv: false, reject: false });
}

describe('db:migrate', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createEmptyTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('migrates an empty database with only DATABASE_URL set', async () => {
    const result = await runMigrate({ DATABASE_URL: database.url });

    expect(result.exitCode).toBe(0);
    const { rows } = await database.db.execute<{ name: string | null }>(
      sql`SELECT to_regclass('public.runners')::text AS name`,
    );
    expect(rows[0]?.name).toBe('runners');
  });

  it('fails naming DATABASE_URL when it is missing', async () => {
    const result = await runMigrate({});

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('DATABASE_URL');
  });
});
