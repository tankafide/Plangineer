// Prints a signed-in session cookie for a new user, as JSON, for the Playwright journeys.
import { createAuth } from '../auth/auth.ts';
import { createDatabase } from '../db/client.ts';
import { parseEnv } from '../env.ts';
import { sessionCookie, storeUser } from './fixtures.ts';

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);

try {
  const auth = createAuth({ db, env });
  const user = await storeUser(auth, { name: 'E2E Engineer' });
  const cookie = await sessionCookie(auth, user.id);
  const separator = cookie.indexOf('=');
  process.stdout.write(
    `${JSON.stringify({ name: cookie.slice(0, separator), value: cookie.slice(separator + 1) })}
`,
  );
} finally {
  await pool.end();
}
