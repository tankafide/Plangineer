import { pickRunner } from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import { listActiveRunnersForUser, lockRunnerForUser } from './runner-repository.ts';

/**
 * Picks the user's most recently seen runner and locks it, rechecking it is not revoked, so a
 * concurrent revoke orders before or after the whole transaction that queues work on it.
 */
export async function lockActiveRunner(
  tx: Transaction,
  userId: string,
): Promise<Result<string, 'RUNNER_REQUIRED'>> {
  const runnerId = pickRunner(await listActiveRunnersForUser(tx, userId));
  if (runnerId === null) return fail('RUNNER_REQUIRED');
  const runner = await lockRunnerForUser(tx, userId, runnerId);
  return runner === undefined || runner.status === 'revoked'
    ? fail('RUNNER_REQUIRED')
    : ok(runnerId);
}
