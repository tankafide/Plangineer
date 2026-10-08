import { parseEnv } from '../env.ts';
import { createLogger } from '../logger.ts';
import { isLocalDatabaseUrl } from './local-host.ts';
import { createDatabase } from './client.ts';
import { resetDatabase } from './reset-database.ts';
import { seedDatabase } from './seed.ts';

const env = parseEnv(process.env);
const logger = createLogger(env.LOG_LEVEL);

if (isLocalDatabaseUrl(env.DATABASE_URL)) {
  await resetDatabase(env.DATABASE_URL, logger);
  const { db, pool } = createDatabase(env.DATABASE_URL);
  try {
    await seedDatabase(db);
  } finally {
    await pool.end();
  }
  logger.info('Database seeded');
} else {
  logger.error('db:reset refuses a DATABASE_URL whose host is not local');
  process.exitCode = 1;
}
