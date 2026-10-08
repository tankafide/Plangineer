// Prints a signed-in session cookie as JSON, for the Playwright journeys and screenshot checks.
// With no argument it signs in a new user. `--user seed-admin` or `--user seed-member` signs in
// that user from the dev seed.
import { parseArgs } from 'node:util';
import { createAuth } from '../auth/auth.ts';
import { createDatabase } from '../db/client.ts';
import { SEED_USER_IDS } from '../db/seed-ids.ts';
import { parseEnv } from '../env.ts';
import { sessionCookie, storeUser } from './fixtures.ts';

const SEEDED_USERS: Record<string, string> = {
  'seed-admin': SEED_USER_IDS.admin,
  'seed-member': SEED_USER_IDS.member,
};

const { values } = parseArgs({ options: { user: { type: 'string' } } });
const seededId = values.user === undefined ? undefined : SEEDED_USERS[values.user];
if (values.user !== undefined && seededId === undefined) {
  throw new Error(`--user must be one of: ${Object.keys(SEEDED_USERS).join(', ')}`);
}

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);

try {
  const auth = createAuth({ db, env });
  const userId = seededId ?? (await storeUser(auth, { name: 'E2E Engineer' })).id;
  const cookie = await sessionCookie(auth, userId);
  const separator = cookie.indexOf('=');
  process.stdout.write(
    `${JSON.stringify({ name: cookie.slice(0, separator), value: cookie.slice(separator + 1) })}\n`,
  );
} finally {
  await pool.end();
}
