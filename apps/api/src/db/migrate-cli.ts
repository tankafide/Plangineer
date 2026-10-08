import { parseEnv } from '../env.ts';
import { createDatabase } from './client.ts';
import { migrateDatabase } from './migrate.ts';

const env = parseEnv(process.env);
const { db, pool } = createDatabase(env.DATABASE_URL);

try {
  await migrateDatabase(db);
} finally {
  await pool.end();
}
