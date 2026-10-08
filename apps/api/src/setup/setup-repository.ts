import {
  type RepositoryScan,
  RepositoryScan as RepositoryScanSchema,
  RunEvent,
  type RunStatus,
  SetupJob,
  SetupSelection,
  type SetupStatus,
} from '@plangineer/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { repositorySetups, runEvents, runs } from '../db/schema.ts';

/** The setup's status, read under its repository's lock, or null before the first scan. */
export async function findSetupStatus(
  executor: Executor,
  repositoryId: string,
): Promise<SetupStatus | null> {
  const [row] = await executor
    .select({ status: repositorySetups.status })
    .from(repositorySetups)
    .where(eq(repositorySetups.repositoryId, repositoryId));
  return row?.status ?? null;
}

/**
 * Stores a scan as the repository's setup at this status, clearing everything a start or a
 * pull request set, so a new setup begins from the scan.
 */
export async function saveScan(
  tx: Transaction,
  repositoryId: string,
  scan: RepositoryScan,
  status: SetupStatus,
): Promise<void> {
  const reset = {
    status,
    scan: RepositoryScanSchema.parse(scan),
    selection: null,
    job: null,
    runId: null,
    pullRequestNumber: null,
    pullRequestUrl: null,
    failureMessage: null,
  };
  await tx
    .insert(repositorySetups)
    .values({ repositoryId, ...reset })
    .onConflictDoUpdate({ target: repositorySetups.repositoryId, set: reset });
}

export interface LockedSetup {
  id: string;
  status: SetupStatus;
  scan: RepositoryScan;
  selection: SetupSelection | null;
  job: SetupJob | null;
  runId: string | null;
  pullRequestNumber: number | null;
}

/** Locks the repository's setup row, which start and advanceSetup hold for their whole work. */
export async function lockSetup(
  tx: Transaction,
  repositoryId: string,
): Promise<LockedSetup | undefined> {
  const [row] = await tx
    .select({
      id: repositorySetups.id,
      status: repositorySetups.status,
      scan: repositorySetups.scan,
      selection: repositorySetups.selection,
      job: repositorySetups.job,
      runId: repositorySetups.runId,
      pullRequestNumber: repositorySetups.pullRequestNumber,
    })
    .from(repositorySetups)
    .where(eq(repositorySetups.repositoryId, repositoryId))
    .for('update');
  if (row === undefined) return undefined;
  return {
    ...row,
    scan: RepositoryScanSchema.parse(row.scan),
    selection: row.selection === null ? null : SetupSelection.parse(row.selection),
    job: row.job === null ? null : SetupJob.parse(row.job),
  };
}

export async function markStarted(
  tx: Transaction,
  setupId: string,
  started: { selection: SetupSelection; job: SetupJob; runId: string },
): Promise<void> {
  await tx
    .update(repositorySetups)
    .set({
      status: 'generating',
      selection: SetupSelection.parse(started.selection),
      job: SetupJob.parse(started.job),
      runId: started.runId,
      failureMessage: null,
    })
    .where(eq(repositorySetups.id, setupId));
}

export async function markPullRequestOpen(
  tx: Transaction,
  setupId: string,
  pullRequest: { number: number; url: string },
): Promise<void> {
  await tx
    .update(repositorySetups)
    .set({
      status: 'pr_open',
      pullRequestNumber: pullRequest.number,
      pullRequestUrl: pullRequest.url,
    })
    .where(eq(repositorySetups.id, setupId));
}

export async function markComplete(tx: Transaction, setupId: string): Promise<void> {
  await tx
    .update(repositorySetups)
    .set({ status: 'complete' })
    .where(eq(repositorySetups.id, setupId));
}

const SETUP_FAILURE_MESSAGE_MAX = 2_000;

export async function markFailed(tx: Transaction, setupId: string, message: string): Promise<void> {
  await tx
    .update(repositorySetups)
    .set({ status: 'failed', failureMessage: message.slice(0, SETUP_FAILURE_MESSAGE_MAX) })
    .where(eq(repositorySetups.id, setupId));
}

/** The repository whose setup a run serves, or undefined for a run no setup points at. */
export async function findRepositoryIdForRun(
  executor: Executor,
  runId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ repositoryId: repositorySetups.repositoryId })
    .from(repositorySetups)
    .where(eq(repositorySetups.runId, runId));
  return row?.repositoryId;
}

type Pushed = Extract<RunEvent, { type: 'setup.pushed' }>;

/** What a setup run has reported: its status, its push, and its final message or failure. */
export interface SetupRunOutcome {
  status: RunStatus;
  pushed: Pushed | undefined;
  resultText: string | undefined;
  failureMessage: string | undefined;
}

export async function findSetupRunOutcome(
  executor: Executor,
  runId: string,
): Promise<SetupRunOutcome | undefined> {
  const [run] = await executor.select({ status: runs.status }).from(runs).where(eq(runs.id, runId));
  if (run === undefined) return undefined;
  const rows = await executor
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        inArray(runEvents.type, ['setup.pushed', 'run.succeeded', 'run.failed']),
      ),
    )
    .orderBy(asc(runEvents.eventId));
  const outcome: SetupRunOutcome = {
    status: run.status,
    pushed: undefined,
    resultText: undefined,
    failureMessage: undefined,
  };
  for (const { payload } of rows) {
    const event = RunEvent.parse(payload);
    if (event.type === 'setup.pushed') outcome.pushed = event;
    if (event.type === 'run.succeeded') outcome.resultText = event.resultText;
    if (event.type === 'run.failed') outcome.failureMessage = event.message;
  }
  return outcome;
}
