// Stores a GitHub App for the Playwright journeys when none exists, then prints the stored App's
// client ID and whether this run created it, as JSON. `--remove` deletes the e2e App again, so
// pnpm test:e2e never leaves it in the dev database.
import { generateKeyPairSync } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { createDatabase } from '../db/client.ts';
import { githubApps } from '../db/schema.ts';
import { parseEnv } from '../env.ts';
import { createGithubAppStore } from '../github/github-app-store.ts';

const E2E_CLIENT_ID = 'e2e-github-client-id';

const { values } = parseArgs({ options: { remove: { type: 'boolean', default: false } } });
const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);

async function storeE2eApp(): Promise<{ clientId: string; created: boolean }> {
  const store = createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET });
  const existing = await store.get();
  if (existing !== null) return { clientId: existing.clientId, created: false };
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const saved = await store.save({
    appId: 1,
    slug: 'plangineer-e2e',
    clientId: E2E_CLIENT_ID,
    clientSecret: 'e2e-github-client-secret',
    privateKey,
    ownerLogin: 'plangineer-e2e',
  });
  return { clientId: E2E_CLIENT_ID, created: saved === 'saved' };
}

try {
  if (values.remove) {
    await db.delete(githubApps).where(eq(githubApps.clientId, E2E_CLIENT_ID));
  } else {
    process.stdout.write(`${JSON.stringify(await storeE2eApp())}\n`);
  }
} finally {
  await pool.end();
}
