import type { RunJob } from '@plangineer/contracts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { lockRunnerForClaim } from '../runners/runner-repository.ts';
import {
  countActiveRuns,
  listCancelRequestedRuns,
  lockClaimableRuns,
} from './run-dispatch-repository.ts';
import { appendRunEvents } from './run-events-repository.ts';

export interface ClaimedRun {
  runId: string;
  attempt: number;
  job: RunJob;
}

/**
 * Leases the runner's oldest queued runs up to its free slots, in one transaction. The runner
 * row lock serializes claims per runner, and SKIP LOCKED keeps two claims off one run. An
 * offline, revoked or plan-limited runner, or one that never said hello, gets nothing.
 */
export async function claimRuns(
  { db, env, logger }: ServiceDeps,
  runnerId: string,
): Promise<ClaimedRun[]> {
  return db.transaction(async (tx) => {
    const runner = await lockRunnerForClaim(tx, runnerId, env.RUNNER_OFFLINE_AFTER_MS);
    if (
      runner === undefined ||
      runner.status !== 'active' ||
      !runner.online ||
      runner.concurrencyLimit === null ||
      runner.planLimited
    ) {
      return [];
    }
    const free = runner.concurrencyLimit - (await countActiveRuns(tx, runnerId));
    if (free <= 0) return [];
    const claimed: ClaimedRun[] = [];
    for (const run of await lockClaimableRuns(tx, runnerId, free)) {
      const attempt = run.attempt + 1;
      await appendRunEvents(tx, run.id, [{ body: { type: 'run.leased', runnerId, attempt } }], {
        leaseDurationMs: env.RUN_LEASE_DURATION_MS,
        logger,
      });
      claimed.push({ runId: run.id, attempt, job: run.job });
    }
    return claimed;
  });
}

/** What a runner's socket must send now: new assignments, and cancels for its active runs. */
export async function planDispatch(deps: ServiceDeps, runnerId: string) {
  const assigned = await claimRuns(deps, runnerId);
  const cancels = await listCancelRequestedRuns(deps.db, runnerId);
  return { assigned, cancels };
}
