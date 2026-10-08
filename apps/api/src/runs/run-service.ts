import {
  type PageInput,
  type Run,
  type RunCreateInput,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from '@plangineer/contracts';
import type { Transaction } from '../db/client.ts';
import { toPage } from '../lib/page.ts';
import { fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { lockRunnerForUser, wakeRunner } from '../runners/runner-repository.ts';
import { appendRunEvents, type RunEventItem } from './run-events-repository.ts';
import { findRunForUser, insertRun, listRunsForUser, lockRunForUser } from './run-repository.ts';

async function readRun(tx: Transaction, deps: ServiceDeps, userId: string, runId: string) {
  const run = await findRunForUser(tx, userId, runId, deps.env.RUNNER_OFFLINE_AFTER_MS);
  if (run === undefined) throw new Error(`Run ${runId} vanished inside its transaction`);
  return run;
}

/** Queues a test run on one of the user's runners. An offline runner picks it up later. */
export async function createRun(
  deps: ServiceDeps,
  userId: string,
  input: RunCreateInput,
): Promise<Result<Run, 'NOT_FOUND' | 'CONFLICT'>> {
  const { db, env, logger } = deps;
  return db.transaction(async (tx) => {
    // The runner lock orders this after a concurrent revoke, which then refuses the run.
    const runner = await lockRunnerForUser(tx, userId, input.runnerId);
    if (runner === undefined) return fail('NOT_FOUND');
    if (runner.status === 'revoked') return fail('CONFLICT');
    const runId = await insertRun(tx, userId, input);
    await appendRunEvents(tx, runId, [{ body: { type: 'run.queued' } }], {
      leaseDurationMs: env.RUN_LEASE_DURATION_MS,
      logger,
    });
    await wakeRunner(tx, input.runnerId);
    return ok(await readRun(tx, deps, userId, runId));
  });
}

export async function getRun(
  { db, env }: ServiceDeps,
  userId: string,
  runId: string,
): Promise<Result<Run, 'NOT_FOUND'>> {
  const run = await findRunForUser(db, userId, runId, env.RUNNER_OFFLINE_AFTER_MS);
  return run === undefined ? fail('NOT_FOUND') : ok(run);
}

export async function listRuns({ db, env }: ServiceDeps, userId: string, page: PageInput) {
  const rows = await listRunsForUser(db, userId, page, env.RUNNER_OFFLINE_AFTER_MS);
  return toPage(rows, page.limit);
}

/**
 * Records a cancel request. The API ends a queued run itself; a leased or running run ends
 * when its runner stops it, or when the sweeper finds its lease lost.
 */
export async function cancelRun(
  deps: ServiceDeps,
  userId: string,
  runId: string,
): Promise<Result<Run, 'NOT_FOUND' | 'CONFLICT'>> {
  const { db, env, logger } = deps;
  return db.transaction(async (tx) => {
    const run = await lockRunForUser(tx, userId, runId);
    if (run === undefined) return fail('NOT_FOUND');
    if ((TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(run.status)) {
      return fail('CONFLICT');
    }
    const items: RunEventItem[] = [{ body: { type: 'run.cancel_requested' } }];
    if (run.status === 'queued') {
      items.push({ body: { type: 'run.cancelled', reason: 'requested' } });
    }
    await appendRunEvents(tx, runId, items, { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger });
    await wakeRunner(tx, run.runnerId);
    return ok(await readRun(tx, deps, userId, runId));
  });
}
