import type { Logger } from '../logger.ts';

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface InitialContext {
  logger: Logger;
  session: { user: SessionUser } | null;
}
