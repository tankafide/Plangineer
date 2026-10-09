import { parseEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { createDatabase } from './client.ts';
import { isLocalDatabaseUrl } from './local-host.ts';
import { seedDatabase } from './seed.ts';

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL, env.API_LOG_FILE);

if (isLocalDatabaseUrl(env.DATABASE_URL)) {
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    await seedDatabase(db);
    logger.info('Database seeded');
  } finally {
    await pool.end();
  }
} else {
  logger.error('db:seed refuses a DATABASE_URL whose host is not local');
  process.exitCode = 1;
}
