import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';

/** What every service operation needs: the database, the parsed environment and a logger. */
export interface ServiceDeps {
  db: Database;
  env: Env;
  logger: Logger;
}
