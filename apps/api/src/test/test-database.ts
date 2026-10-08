import { randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { inject } from 'vitest';
import { createDatabase, type Database } from '../db/client.ts';
import { maintenanceUrl } from '../db/reset-database.ts';

export const TEMPLATE_DATABASE = 'plangineer_test_template';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** The URL of the named database on the server that DATABASE_URL points at. */
export function databaseUrl(serverUrl: string, name: string): string {
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

async function onMaintenance(statement: (client: Client) => Promise<unknown>): Promise<void> {
  const client = new Client({ connectionString: maintenanceUrl(inject('databaseUrl')) });
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
  const name = `plangineer_test_${randomUUID().replaceAll('-', '')}`;
  await onMaintenance((client) =>
    client.query(
      `CREATE DATABASE ${client.escapeIdentifier(name)} TEMPLATE ${client.escapeIdentifier(TEMPLATE_DATABASE)}`,
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
