import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv as parseEnvFile } from 'node:util';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { createDatabase } from '../db/client.ts';
import { databaseUrl, MAINTENANCE_DATABASE } from '../db/database-url.ts';
import { resetDatabase } from '../db/reset-database.ts';
import { parseEnv } from '../env.ts';
import { createGithubAppStore } from '../github/github-app-store.ts';
import { createLogger } from '../logger.ts';
import { createTestRunPrefix, templateDatabase } from './test-database.ts';
import { TEST_AUTH_SECRET, testGithubApp } from './test-github-app.ts';

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

/** Stores the test App in the template, so every cloned test database starts with it. */
async function storeTestGithubApp(url: string, privateKey: string): Promise<void> {
  const { db, pool } = createDatabase(url);
  try {
    await createGithubAppStore({ db, secret: TEST_AUTH_SECRET }).save(testGithubApp(privateKey));
  } finally {
    await pool.end();
  }
}

/**
 * Creates and migrates this run's template database, which every test file clones, with the test
 * GitHub App and its key, generated once per run.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  // Read .env without loading it into process.env, which every Vitest project shares.
  const envFile = readFileSync(fileURLToPath(new URL('../../../../.env', import.meta.url)), 'utf8');
  const env = parseEnv(parseEnvFile(envFile));
  const runPrefix = createTestRunPrefix();
  const template = templateDatabase(runPrefix);
  const templateUrl = databaseUrl(env.DATABASE_URL, template);
  await resetDatabase(templateUrl, createLogger('warn'));
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  await storeTestGithubApp(templateUrl, privateKey);
  project.provide('githubAppPrivateKey', privateKey);
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
