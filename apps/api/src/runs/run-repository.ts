import {
  type PageInput,
  type Repository,
  Run,
  type RunKind,
  type RunStatus,
  RunSummary,
} from '@plangineer/contracts';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { toIsoOrNull } from '../lib/dates.ts';
import { runners, runs } from '../db/schema.ts';
import { runnerOnline } from '../runners/runner-repository.ts';

const OPEN_STATUSES: RunStatus[] = ['queued', 'leased', 'running'];

function summaryColumns(offlineAfterMs: number) {
  return {
    id: runs.id,
    kind: runs.kind,
    status: runs.status,
    repositoryOwner: runs.repositoryOwner,
    repositoryName: runs.repositoryName,
    ref: runs.ref,
    attempt: runs.attempt,
    cancelRequested: runs.cancelRequested,
    createdAt: runs.createdAt,
    startedAt: runs.startedAt,
    endedAt: runs.endedAt,
    commit: runs.commit,
    runnerId: runners.id,
    runnerName: runners.name,
    runnerOnline: runnerOnline(offlineAfterMs),
    runnerLastSeenAt: runners.lastSeenAt,
    runnerPlanLimitResetsAt: runners.planLimitResetsAt,
  };
}

interface SummaryRow {
  id: string;
  kind: RunKind;
  status: RunStatus;
  repositoryOwner: string;
  repositoryName: string;
  ref: string;
  attempt: number;
  cancelRequested: boolean;
  createdAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  commit: string | null;
  runnerId: string;
  runnerName: string;
  runnerOnline: boolean;
  runnerLastSeenAt: Date | null;
  runnerPlanLimitResetsAt: Date | null;
}

function toSummary(row: SummaryRow) {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    repository: { owner: row.repositoryOwner, name: row.repositoryName },
    ref: row.ref,
    attempt: row.attempt,
    cancelRequested: row.cancelRequested,
    createdAt: row.createdAt.toISOString(),
    startedAt: toIsoOrNull(row.startedAt),
    endedAt: toIsoOrNull(row.endedAt),
    commit: row.commit,
    runner: {
      id: row.runnerId,
      name: row.runnerName,
      online: row.runnerOnline,
      lastSeenAt: toIsoOrNull(row.runnerLastSeenAt),
      planLimitResetsAt: toIsoOrNull(row.runnerPlanLimitResetsAt),
    },
  };
}

export interface NewRun {
  kind: RunKind;
  runnerId: string;
  repository: Repository;
  ref: string;
  prompt: string;
}

export async function insertRun(tx: Transaction, userId: string, input: NewRun): Promise<string> {
  const [row] = await tx
    .insert(runs)
    .values({
      kind: input.kind,
      userId,
      runnerId: input.runnerId,
      repositoryOwner: input.repository.owner,
      repositoryName: input.repository.name,
      ref: input.ref,
      prompt: input.prompt,
    })
    .returning({ id: runs.id });
  if (row === undefined) throw new Error('Run insert returned no row');
  return row.id;
}

export async function findRunForUser(
  executor: Executor,
  userId: string,
  runId: string,
  offlineAfterMs: number,
): Promise<Run | undefined> {
  const [row] = await executor
    .select({ ...summaryColumns(offlineAfterMs), prompt: runs.prompt })
    .from(runs)
    .innerJoin(runners, eq(runners.id, runs.runnerId))
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)));
  return row === undefined ? undefined : Run.parse({ ...toSummary(row), prompt: row.prompt });
}

/** One page of the user's runs, id descending, with one extra row to tell if more exist. */
export async function listRunsForUser(
  executor: Executor,
  userId: string,
  { cursor, limit }: PageInput,
  offlineAfterMs: number,
): Promise<RunSummary[]> {
  const rows = await executor
    .select(summaryColumns(offlineAfterMs))
    .from(runs)
    .innerJoin(runners, eq(runners.id, runs.runnerId))
    .where(and(eq(runs.userId, userId), cursor === undefined ? undefined : lt(runs.id, cursor)))
    .orderBy(desc(runs.id))
    .limit(limit + 1);
  return rows.map((row) => RunSummary.parse(toSummary(row)));
}

/** Locks the user's run row, the lock every event append on the run also takes. */
export async function lockRunForUser(
  tx: Transaction,
  userId: string,
  runId: string,
): Promise<{ status: RunStatus; runnerId: string } | undefined> {
  const [row] = await tx
    .select({ status: runs.status, runnerId: runs.runnerId })
    .from(runs)
    .where(and(eq(runs.id, runId), eq(runs.userId, userId)))
    .for('update');
  return row;
}

/** Locks the runner's queued, leased and running runs, oldest first. */
export async function lockOpenRunsOfRunner(tx: Transaction, runnerId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.runnerId, runnerId), inArray(runs.status, OPEN_STATUSES)))
    .orderBy(asc(runs.id))
    .for('update');
  return rows.map((row) => row.id);
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Run ${runId} does not exist`);
    this.name = 'RunNotFoundError';
  }
}

/** The run's event id counter: the id of its newest event, or 0 before any event. */
export async function findLastEventId(executor: Executor, runId: string): Promise<number> {
  const [row] = await executor
    .select({ lastEventId: runs.lastEventId })
    .from(runs)
    .where(eq(runs.id, runId));
  if (row === undefined) throw new RunNotFoundError(runId);
  return row.lastEventId;
}
