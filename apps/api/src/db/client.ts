import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

export type Database = NodePgDatabase<typeof schema>;

export function createDatabase(url: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle({ client: pool, schema, casing: 'snake_case' }), pool };
}

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** A database or an open transaction, which every repository function takes. */
export type Executor = Database | Transaction;
