import { parseEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { isLocalDatabaseUrl } from './local-host.ts';
import { createDatabase } from './client.ts';
import { resetDatabase } from './reset-database.ts';
import { githubApps } from './schema.ts';
import { seedDatabase } from './seed.ts';

/** Postgres error codes for a database or a table that does not exist yet. */
const NOTHING_TO_KEEP = new Set(['3D000', '42P01']);

function postgresCode(error: unknown): unknown {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ('code' in current) return current.code;
  }
  return undefined;
}

/** The dev GitHub App, read before the reset so it survives it. */
async function readGithubApp(url: string) {
  const { db, pool } = createDatabase(url);
  try {
    const [row] = await db.select().from(githubApps).limit(1);
    return row;
  } catch (error) {
    if (NOTHING_TO_KEEP.has(String(postgresCode(error)))) return undefined;
    throw error;
  } finally {
    await pool.end();
  }
}

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL, env.API_LOG_FILE);

if (isLocalDatabaseUrl(env.DATABASE_URL)) {
  const githubApp = await readGithubApp(env.DATABASE_URL);
  await resetDatabase(env.DATABASE_URL, logger);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    if (githubApp !== undefined) await db.insert(githubApps).values(githubApp);
    await seedDatabase(db);
  } finally {
    await pool.end();
  }
  logger.info({ githubAppKept: githubApp !== undefined }, 'Database seeded');
} else {
  logger.error('db:reset refuses a DATABASE_URL whose host is not local');
  process.exitCode = 1;
}
