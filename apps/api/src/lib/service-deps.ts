import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';
import type { Github } from '../github/github.ts';
import type { Logger } from '../logger.ts';

/** What every service operation needs: the database, the environment, a logger and GitHub. */
export interface ServiceDeps {
  db: Database;
  env: Env;
  logger: Logger;
  github: Github;
}
