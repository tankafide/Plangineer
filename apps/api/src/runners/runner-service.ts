import type { PageInput, Runner } from '@plangineer/contracts';
import type { Database } from '../db/client.ts';
import { toPage } from '../lib/page.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { lockOpenRunsOfRunner } from '../runs/run-repository.ts';
import { advanceSetupOfRun } from '../setup/setup-advance.ts';
import { hashSecret } from './pairing.ts';
import {
  findActiveRunnerByTokenHash,
  findRunnerForUser,
  listRunnersForUser,
  lockRunnerForUser,
  markRunnerRevoked,
  wakeRunner,
} from './runner-repository.ts';

export async function listRunners({ db, env }: ServiceDeps, userId: string, page: PageInput) {
  const rows = await listRunnersForUser(db, userId, page, env.RUNNER_OFFLINE_AFTER_MS);
  return toPage(rows, page.limit);
}

/**
 * Revokes the runner and cancels its open runs. A wake tells the process holding its socket
 * to close it, and its late events reach runs that have already ended.
 */
export async function revokeRunner(
  deps: ServiceDeps,
  userId: string,
  runnerId: string,
): Promise<Result<Runner, 'NOT_FOUND'>> {
  const { db, env, logger } = deps;
  const revoked = await db.transaction(async (tx) => {
    const locked = await lockRunnerForUser(tx, userId, runnerId);
    if (locked === undefined) return fail('NOT_FOUND');
    const cancelledRunIds: string[] = [];
    if (locked.status === 'active') {
      await markRunnerRevoked(tx, runnerId);
      for (const runId of await lockOpenRunsOfRunner(tx, runnerId)) {
        await appendRunEvents(
          tx,
          runId,
          [{ body: { type: 'run.cancelled', reason: 'runner_revoked' } }],
          { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger },
        );
        cancelledRunIds.push(runId);
      }
      await wakeRunner(tx, runnerId);
    }
    const runner = await findRunnerForUser(tx, userId, runnerId, env.RUNNER_OFFLINE_AFTER_MS);
    if (runner === undefined) throw new Error(`Runner ${runnerId} vanished under its lock`);
    return ok({ runner, cancelledRunIds });
  });
  if (!revoked.ok) return revoked;
  for (const runId of revoked.value.cancelledRunIds) await advanceSetupOfRun(deps, runId);
  return ok(revoked.value.runner);
}

/** The active runner a token belongs to, looked up by the token's hash. */
export async function findRunnerByToken(
  db: Database,
  token: string,
): Promise<{ id: string } | undefined> {
  return findActiveRunnerByTokenHash(db, hashSecret(token));
}
