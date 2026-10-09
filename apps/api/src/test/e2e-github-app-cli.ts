// Stores a GitHub App for the Playwright journeys when none exists, then prints the stored App's
// client ID as JSON, so the sign-in journey can check GitHub receives it.
import { generateKeyPairSync } from 'node:crypto';
import { createDatabase } from '../db/client.ts';
import { parseEnv } from '../env.ts';
import { createGithubAppStore } from '../github/github-app-store.ts';

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);

try {
  const store = createGithubAppStore({ db, secret: env.BETTER_AUTH_SECRET });
  if ((await store.get()) === null) {
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    await store.save({
      appId: 1,
      slug: 'plangineer-e2e',
      clientId: 'e2e-github-client-id',
      clientSecret: 'e2e-github-client-secret',
      privateKey,
      ownerLogin: 'plangineer-e2e',
    });
  }
  const app = await store.get();
  if (app === null) throw new Error('No GitHub App is stored');
  process.stdout.write(`${JSON.stringify({ clientId: app.clientId })}\n`);
} finally {
  await pool.end();
}
