import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv as parseEnvFile } from 'node:util';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { databaseUrl, MAINTENANCE_DATABASE } from '../db/database-url.ts';
import { resetDatabase } from '../db/reset-database.ts';
import { parseEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { TEMPLATE_DATABASE } from './test-database.ts';

async function leftoverTestDatabases(serverUrl: string): Promise<string[]> {
  const client = new Client({ connectionString: databaseUrl(serverUrl, MAINTENANCE_DATABASE) });
  await client.connect();
  try {
    const { rows } = await client.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 'plangineer\\_test\\_%' AND datname <> $1`,
      [TEMPLATE_DATABASE],
    );
    return rows.map((row) => row.datname);
  } finally {
    await client.end();
  }
}

/** Recreates and migrates the template database that every test file clones. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Read .env without loading it into process.env, which every Vitest project shares.
  const envFile = readFileSync(fileURLToPath(new URL('../../../../.env', import.meta.url)), 'utf8');
  const env = parseEnv(parseEnvFile(envFile));
  await resetDatabase(databaseUrl(env.DATABASE_URL, TEMPLATE_DATABASE), createLogger('warn'));
  project.provide('databaseUrl', env.DATABASE_URL);

  return async () => {
    const leftovers = await leftoverTestDatabases(env.DATABASE_URL);
    if (leftovers.length > 0) {
      throw new Error(`Test databases were not dropped: ${leftovers.join(', ')}`);
    }
  };
}
