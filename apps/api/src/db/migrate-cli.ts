import { z } from 'zod';
import { createDatabase } from './client.ts';
import { migrateDatabase } from './migrate.ts';

/** Migrating needs only the database, so the migrate bundle runs with DATABASE_URL alone. */
const MigrateEnvSchema = z.object({ DATABASE_URL: z.url() });

const parsed = MigrateEnvSchema.safeParse(process.env);
if (!parsed.success) {
  const problems = parsed.error.issues.map(
    (issue) => `  ${issue.path.join('.')}: ${issue.message}`,
  );
  throw new Error(`Invalid environment:\n${problems.join('\n')}`);
}
const { db, pool } = createDatabase(parsed.data.DATABASE_URL);

try {
  await migrateDatabase(db);
} finally {
  await pool.end();
}
