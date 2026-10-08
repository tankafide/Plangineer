import { Client } from 'pg';
import type { Logger } from '../logger.ts';
import { createDatabase } from './client.ts';
import { migrateDatabase } from './migrate.ts';

function databaseName(url: URL): string {
  return decodeURIComponent(url.pathname.slice(1));
}

/** Connects to the server's postgres maintenance database, for statements on other databases. */
export function maintenanceUrl(url: string): string {
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  return maintenance.toString();
}

/** Drops and recreates the database at url, then applies every migration. */
export async function resetDatabase(url: string, logger: Logger): Promise<void> {
  const name = databaseName(new URL(url));
  const client = new Client({ connectionString: maintenanceUrl(url) });
  await client.connect();
  try {
    const identifier = client.escapeIdentifier(name);
    await client.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${identifier}`);
  } finally {
    await client.end();
  }
  const { db, pool } = createDatabase(url);
  try {
    await migrateDatabase(db);
  } finally {
    await pool.end();
  }
  logger.info({ database: name }, 'Database reset');
}
