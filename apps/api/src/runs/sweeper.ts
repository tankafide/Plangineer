import { leaseLostOutcome } from '@plangineer/domain';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { wakeRunner } from '../runners/runner-repository.ts';
import { advanceSetupOfRun } from '../setup/setup-advance.ts';
import { listLapsedRunIds, lockLapsedRun } from './run-dispatch-repository.ts';
import { appendRunEvents, type RunEventItem } from './run-events-repository.ts';

/** The most lapsed leases one sweep handles. The next tick takes the rest. */
const SWEEP_BATCH = 100;

function leaseLostMessage(status: 'leased' | 'running', attempt: number): string {
  return status === 'running'
    ? 'The runner stopped responding after the run started, so it was not retried.'
    : `The runner stopped responding before the run started, on all ${attempt} attempts.`;
}

/**
 * Handles every run whose lease lapsed, each in its own transaction: records the lost lease,
 * then requeues, fails or cancels the run as leaseLostOutcome decides. A requeued run wakes
 * its runner. Returns how many runs it handled.
 */
export async function sweepLapsedLeases(deps: ServiceDeps): Promise<number> {
  const { db, env, logger } = deps;
  let handled = 0;
  for (const runId of await listLapsedRunIds(db, SWEEP_BATCH)) {
    const swept = await db.transaction(async (tx) => {
      const run = await lockLapsedRun(tx, runId);
      if (run === undefined) return undefined;
      const outcome = leaseLostOutcome({ ...run, maxAttempts: env.RUN_MAX_ATTEMPTS });
      const items: RunEventItem[] = [
        { body: { type: 'run.lease_lost', attempt: run.attempt, requeued: outcome.requeued } },
      ];
      if (outcome.event === 'run.failed') {
        items.push({
          body: {
            type: 'run.failed',
            reason: 'lease_lost',
            message: leaseLostMessage(run.status, run.attempt),
            exitCode: null,
            stderrTail: [],
          },
        });
      } else if (outcome.event === 'run.cancelled') {
        items.push({ body: { type: 'run.cancelled', reason: 'requested' } });
      }
      const appended = await appendRunEvents(tx, runId, items, {
        leaseDurationMs: env.RUN_LEASE_DURATION_MS,
        logger,
      });
      if (outcome.requeued) await wakeRunner(tx, run.runnerId);
      return appended;
    });
    if (swept === undefined) continue;
    handled += 1;
    if (swept.ended) await advanceSetupOfRun(deps, runId);
  }
  return handled;
}
