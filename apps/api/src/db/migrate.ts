import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PACKAGE_ROOT } from '../package-root.ts';
import type { Database } from './client.ts';

const MIGRATIONS_FOLDER = path.join(PACKAGE_ROOT, 'drizzle');

export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
