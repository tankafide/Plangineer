import type { RunJob, RunStatus } from '@plangineer/contracts';
import { and, asc, count, eq, inArray, lt, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { runs } from '../db/schema.ts';

/** Queries for dispatch, the sweeper and the runner socket, which act on a runner's runs. */

const ACTIVE_STATUSES: RunStatus[] = ['leased', 'running'];

export async function countActiveRuns(tx: Transaction, runnerId: string): Promise<number> {
  const [row] = await tx
    .select({ count: count() })
    .from(runs)
    .where(and(eq(runs.runnerId, runnerId), inArray(runs.status, ACTIVE_STATUSES)));
  return row?.count ?? 0;
}

export interface ClaimableRun {
  id: string;
  attempt: number;
  job: RunJob;
}

/** Locks up to limit of the runner's queued runs that no one asked to cancel, oldest first. */
export async function lockClaimableRuns(
  tx: Transaction,
  runnerId: string,
  limit: number,
): Promise<ClaimableRun[]> {
  const rows = await tx
    .select({
      id: runs.id,
      attempt: runs.attempt,
      repositoryOwner: runs.repositoryOwner,
      repositoryName: runs.repositoryName,
      ref: runs.ref,
      prompt: runs.prompt,
    })
    .from(runs)
    .where(
      and(eq(runs.runnerId, runnerId), eq(runs.status, 'queued'), eq(runs.cancelRequested, false)),
    )
    .orderBy(asc(runs.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  return rows.map((row) => ({
    id: row.id,
    attempt: row.attempt,
    job: {
      repository: { owner: row.repositoryOwner, name: row.repositoryName },
      ref: row.ref,
      prompt: row.prompt,
      permissionMode: 'plan',
    },
  }));
}

/** The runner's leased and running runs that someone asked to cancel. */
export async function listCancelRequestedRuns(
  executor: Executor,
  runnerId: string,
): Promise<{ runId: string; attempt: number }[]> {
  return executor
    .select({ runId: runs.id, attempt: runs.attempt })
    .from(runs)
    .where(
      and(
        eq(runs.runnerId, runnerId),
        inArray(runs.status, ACTIVE_STATUSES),
        eq(runs.cancelRequested, true),
      ),
    )
    .orderBy(asc(runs.id));
}

/** The ids of runs whose lease lapsed, by the database clock. */
export async function listLapsedRunIds(executor: Executor, limit: number): Promise<string[]> {
  const rows = await executor
    .select({ id: runs.id })
    .from(runs)
    .where(and(inArray(runs.status, ACTIVE_STATUSES), lt(runs.leaseExpiresAt, sql`now()`)))
    .orderBy(asc(runs.leaseExpiresAt), asc(runs.id))
    .limit(limit);
  return rows.map((row) => row.id);
}

export interface LapsedRun {
  status: 'leased' | 'running';
  attempt: number;
  cancelRequested: boolean;
  runnerId: string;
}

/** Locks a run whose lease still lapsed, skipping it when another process holds it. */
export async function lockLapsedRun(
  tx: Transaction,
  runId: string,
): Promise<LapsedRun | undefined> {
  const [row] = await tx
    .select({
      status: runs.status,
      attempt: runs.attempt,
      cancelRequested: runs.cancelRequested,
      runnerId: runs.runnerId,
    })
    .from(runs)
    .where(
      and(
        eq(runs.id, runId),
        inArray(runs.status, ACTIVE_STATUSES),
        lt(runs.leaseExpiresAt, sql`now()`),
      ),
    )
    .for('update', { skipLocked: true });
  if (row === undefined) return undefined;
  if (row.status !== 'leased' && row.status !== 'running') {
    throw new Error(`Run ${runId} matched the lapsed lease query in status ${row.status}`);
  }
  return { ...row, status: row.status };
}

export interface RunnerRunState {
  status: RunStatus;
  attempt: number;
  cancelRequested: boolean;
}

/** Locks a run for its runner, or returns undefined when the run belongs to another runner. */
export async function lockRunOfRunner(
  tx: Transaction,
  runnerId: string,
  runId: string,
): Promise<RunnerRunState | undefined> {
  const [row] = await tx
    .select({ status: runs.status, attempt: runs.attempt, cancelRequested: runs.cancelRequested })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.runnerId, runnerId)))
    .for('update');
  return row;
}

/** The runner's active runs among the given ids, with their current attempts. */
export async function findActiveRunsOfRunner(
  executor: Executor,
  runnerId: string,
  runIds: string[],
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const rows = await executor
    .select({ id: runs.id, attempt: runs.attempt })
    .from(runs)
    .where(
      and(
        eq(runs.runnerId, runnerId),
        inArray(runs.id, runIds),
        inArray(runs.status, ACTIVE_STATUSES),
      ),
    );
  return new Map(rows.map((row) => [row.id, row.attempt]));
}

/**
 * Extends the lease of the runner's active run at this attempt, by the database clock.
 * Returns the cancel flag, or undefined when the run is not this runner's active attempt.
 */
export async function extendLease(
  executor: Executor,
  {
    runnerId,
    runId,
    attempt,
    leaseDurationMs,
  }: {
    runnerId: string;
    runId: string;
    attempt: number;
    leaseDurationMs: number;
  },
): Promise<{ cancelRequested: boolean } | undefined> {
  const [row] = await executor
    .update(runs)
    .set({ leaseExpiresAt: sql`now() + make_interval(secs => ${leaseDurationMs / 1000})` })
    .where(
      and(
        eq(runs.id, runId),
        eq(runs.runnerId, runnerId),
        eq(runs.attempt, attempt),
        inArray(runs.status, ACTIVE_STATUSES),
      ),
    )
    .returning({ cancelRequested: runs.cancelRequested });
  return row;
}
