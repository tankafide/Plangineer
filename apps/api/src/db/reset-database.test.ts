import { sql } from 'drizzle-orm';
import { Client, type QueryResult } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { resetDatabase } from './reset-database.ts';

async function onDatabase(url: string, statement: string): Promise<QueryResult> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await client.query(statement);
  } finally {
    await client.end();
  }
}

describe('resetDatabase', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  it('drops and recreates the database with every migration applied', async () => {
    // A separate client, so the reset's forced drop ends no connection of the test pool.
    await onDatabase(
      database.url,
      `INSERT INTO "user" (name, email) VALUES ('Old', 'old@example.com')`,
    );
    const before = await onDatabase(
      database.url,
      'SELECT oid FROM pg_database WHERE datname = current_database()',
    );

    await resetDatabase(database.url, silentLogger);

    const after = await onDatabase(
      database.url,
      'SELECT oid FROM pg_database WHERE datname = current_database()',
    );
    expect(after.rows[0].oid).not.toBe(before.rows[0].oid);
    const users = await database.db.execute(sql`SELECT count(*)::int AS count FROM "user"`);
    expect(users.rows).toEqual([{ count: 0 }]);
    const migrations = await database.db.execute(
      sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations`,
    );
    expect(migrations.rows).toEqual([{ count: 1 }]);
  });
});
