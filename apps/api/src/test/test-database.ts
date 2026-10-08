import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../db/client.ts';
import { databaseUrl, MAINTENANCE_DATABASE } from '../db/database-url.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    testRunPrefix: string;
  }
}

/**
 * A prefix unique to one Vitest run, so concurrent runs on one Postgres server never share
 * a template or count each other's clones as leftovers.
 */
export function createTestRunPrefix(): string {
  return `plangineer_test_${randomUUID().slice(0, 8)}`;
}

export function templateDatabase(runPrefix: string): string {
  return `${runPrefix}_template`;
}

async function onMaintenance(statement: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({
    connectionString: databaseUrl(inject('databaseUrl'), MAINTENANCE_DATABASE),
  });
  await client.connect();
  try {
    await statement(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  db: Database;
  pool: Pool;
  url: string;
  drop: () => Promise<void>;
}

/** Clones a fresh, migrated database from the template. Each test file creates one in beforeAll. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const runPrefix = inject('testRunPrefix');
  const name = `${runPrefix}_${randomUUID().replaceAll('-', '')}`;
  await onMaintenance((client) =>
    client.query(
      `CREATE DATABASE ${client.escapeIdentifier(name)} TEMPLATE ${client.escapeIdentifier(templateDatabase(runPrefix))}`,
    ),
  );
  const url = databaseUrl(inject('databaseUrl'), name);
  const { db, pool } = createDatabase(url);
  return {
    db,
    pool,
    url,
    drop: async () => {
      await pool.end();
      await onMaintenance((client) =>
        client.query(`DROP DATABASE IF EXISTS ${client.escapeIdentifier(name)} WITH (FORCE)`),
      );
    },
  };
}
