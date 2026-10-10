import type { Database } from '../db/client.ts';
import { findRunnerByToken } from './runner-service.ts';

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer (\S+)$/.exec(header ?? '');
  return match?.[1];
}

/**
 * The active runner an `Authorization: Bearer <token>` header belongs to, or undefined. The
 * socket upgrade and the runner's HTTP routes share it.
 */
export async function authenticateRunner(
  db: Database,
  authorization: string | undefined,
): Promise<{ id: string } | undefined> {
  const token = bearerToken(authorization);
  return token === undefined ? undefined : findRunnerByToken(db, token);
}
