import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv as parseEnvFile } from 'node:util';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { databaseUrl, MAINTENANCE_DATABASE } from '../db/database-url.ts';
import { resetDatabase } from '../db/reset-database.ts';
import { parseEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { createTestRunPrefix, templateDatabase } from './test-database.ts';

async function onMaintenance<T>(
  serverUrl: string,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: databaseUrl(serverUrl, MAINTENANCE_DATABASE) });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

/** Creates and migrates this run's template database, which every test file clones. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Read .env without loading it into process.env, which every Vitest project shares.
  const envFile = readFileSync(fileURLToPath(new URL('../../../../.env', import.meta.url)), 'utf8');
  const env = parseEnv(parseEnvFile(envFile));
  const runPrefix = createTestRunPrefix();
  const template = templateDatabase(runPrefix);
  await resetDatabase(databaseUrl(env.DATABASE_URL, template), createLogger('warn'));
  project.provide('databaseUrl', env.DATABASE_URL);
  project.provide('testRunPrefix', runPrefix);

  return async () => {
    const leftovers = await onMaintenance(env.DATABASE_URL, async (client) => {
      await client.query(
        `DROP DATABASE IF EXISTS ${client.escapeIdentifier(template)} WITH (FORCE)`,
      );
      const { rows } = await client.query<{ datname: string }>(
        'SELECT datname FROM pg_database WHERE starts_with(datname, $1)',
        [`${runPrefix}_`],
      );
      return rows.map((row) => row.datname);
    });
    if (leftovers.length > 0) {
      throw new Error(`Test databases were not dropped: ${leftovers.join(', ')}`);
    }
  };
}
