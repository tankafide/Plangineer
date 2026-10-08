import type { Database } from '../db/client.ts';
import type { Env } from '../env.ts';
import type { Logger } from '../logger.ts';

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface InitialContext {
  logger: Logger;
  db: Database;
  env: Env;
  session: { user: SessionUser } | null;
}
