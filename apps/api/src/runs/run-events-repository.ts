import {
  type PlanningOutput,
  RunEvent,
  type RunEventBody,
  type RunKind,
  type RunnerRunEventBody,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from '@plangineer/contracts';
import { nextRunStatus } from '@plangineer/domain';
import { and, asc, eq, gt, inArray, isNotNull, max, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { runEvents, runs } from '../db/schema.ts';
import { insertContextFile } from '../features/context-file-repository.ts';
import type { Logger } from '../logger.ts';
import { RUN_EVENTS_CHANNEL } from '../realtime/notifications.ts';
import { kindMismatch, protocolError, type RunFailedBody } from './run-event-checks.ts';

/**
 * An event to append. The API's own events take the run's attempt when appended. A runner's
 * events carry the attempt they belong to and the runner's sequence number.
 */
export type RunEventItem =
  | { body: RunEventBody }
  | { body: RunnerRunEventBody; attempt: number; runnerSeq: number };

const runnerSeqKey = (attempt: number, runnerSeq: number) => `${attempt}:${runnerSeq}`;

/**
 * Applies a planning run's output in the transaction that stores its run.succeeded (D2), and
 * returns the failure to store in place of the success, or null to let the success through.
 */
type PlanningSucceededHook = (
  tx: Transaction,
  runId: string,
  output: PlanningOutput,
) => Promise<RunFailedBody | null>;

export interface AppendOptions {
  leaseDurationMs: number;
  logger: Logger;
  /** Only the runner's events can succeed a planning run, so only their append passes it. */
  onPlanningSucceeded?: PlanningSucceededHook;
}

interface LockedRun {
  kind: RunKind;
  status: RunStatus;
  attempt: number;
  lastEventId: number;
  now: Date;
}

const isTerminal = (status: RunStatus) =>
  (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);

async function lockRun(tx: Transaction, runId: string): Promise<LockedRun> {
  const [row] = await tx
    .select({
      kind: runs.kind,
      status: runs.status,
      attempt: runs.attempt,
      lastEventId: runs.lastEventId,
      now: sql<Date>`now()`.mapWith(runs.createdAt),
    })
    .from(runs)
    .where(eq(runs.id, runId))
    .for('update');
  if (row === undefined) throw new Error(`Run ${runId} does not exist`);
  return row;
}

async function storedRunnerSeqs(tx: Transaction, runId: string, items: RunEventItem[]) {
  const runnerItems = items.filter((item) => 'runnerSeq' in item);
  if (runnerItems.length === 0) return new Set<string>();
  const rows = await tx
    .select({ attempt: runEvents.attempt, runnerSeq: runEvents.runnerSeq })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        inArray(runEvents.attempt, [...new Set(runnerItems.map((item) => item.attempt))]),
        inArray(
          runEvents.runnerSeq,
          runnerItems.map((item) => item.runnerSeq),
        ),
      ),
    );
  return new Set(rows.map((row) => runnerSeqKey(row.attempt, row.runnerSeq ?? 0)));
}

/** The columns a status move sets beside the status itself. */
function statusColumns(body: RunEventBody, now: Date, leaseDurationMs: number) {
  switch (body.type) {
    case 'run.leased':
      return { attempt: body.attempt, leaseExpiresAt: new Date(now.getTime() + leaseDurationMs) };
    case 'run.lease_lost':
      return { leaseExpiresAt: null };
    case 'run.started':
      return { commit: body.commit, startedAt: now };
    case 'run.succeeded':
    case 'run.failed':
    case 'run.cancelled':
      return { endedAt: now, leaseExpiresAt: null };
    default:
      return {};
  }
}

/** The planning output already stored for a planning run, if any. */
async function storedPlanningOutput(
  tx: Transaction,
  runId: string,
): Promise<PlanningOutput | undefined> {
  const [row] = await tx
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), eq(runEvents.type, 'planning.output')))
    .limit(1);
  if (row === undefined) return undefined;
  const event = RunEvent.parse(row.payload);
  if (event.type !== 'planning.output') throw new Error(`Run ${runId} stored a mistyped event`);
  return event.output;
}

export interface AppendResult {
  /** The highest stored runner sequence for the run's current attempt, or 0. */
  ackedSeq: number;
  /** Whether this append moved the run to a terminal status. */
  ended: boolean;
}

/**
 * Appends events to one run in order under its row lock, applying each status move through
 * nextRunStatus. A pre-planning run's run.succeeded stores its context file in the same
 * transaction, and a planning run's applies its planning output through onPlanningSucceeded,
 * whose failure is stored in place of the success. A repeated runner event and any event after
 * the run ended are skipped. An event the rules reject, or one its run's kind cannot have,
 * stops the batch and fails the run with protocol_error instead.
 */
export async function appendRunEvents(
  tx: Transaction,
  runId: string,
  items: RunEventItem[],
  { leaseDurationMs, logger, onPlanningSucceeded }: AppendOptions,
): Promise<AppendResult> {
  const run = await lockRun(tx, runId);
  const stored = await storedRunnerSeqs(tx, runId, items);
  let { status, attempt } = run;
  let eventId = run.lastEventId;
  let cancelRequested = false;
  const rows: (typeof runEvents.$inferInsert)[] = [];

  const insert = async (item: RunEventItem, next: RunStatus) => {
    if (next !== status) {
      const [row] = await tx
        .update(runs)
        .set({ status: next, ...statusColumns(item.body, run.now, leaseDurationMs) })
        .where(and(eq(runs.id, runId), eq(runs.status, status)))
        .returning({ attempt: runs.attempt });
      if (row === undefined) throw new Error(`Run ${runId} left status ${status} under its lock`);
      ({ attempt } = row);
      status = next;
    }
    if (item.body.type === 'run.cancel_requested') cancelRequested = true;
    if (item.body.type === 'run.succeeded' && run.kind === 'pre_planning') {
      await insertContextFile(tx, runId, item.body.resultText);
    }
    eventId += 1;
    rows.push({
      runId,
      eventId,
      attempt: 'attempt' in item ? item.attempt : attempt,
      runnerSeq: 'runnerSeq' in item ? item.runnerSeq : null,
      type: item.body.type,
      payload: RunEvent.parse({ ...item.body, id: eventId, runId, at: run.now.toISOString() }),
    });
  };

  const fail = async (failed: RunFailedBody) => {
    const failedNext = nextRunStatus(status, failed);
    if (!failedNext.ok) throw new Error(`Run ${runId} cannot fail from status ${status}`);
    await insert({ body: failed }, failedNext.status);
  };

  /** Applies the planning output a run.succeeded completes, and returns any failure instead. */
  const planningFailure = (body: RunEventBody): Promise<RunFailedBody | null> | null => {
    if (body.type !== 'run.succeeded' || run.kind !== 'planning') return null;
    if (planningOutput === undefined || onPlanningSucceeded === undefined) {
      throw new Error(`Run ${runId} succeeded as a planning run with no output or no hook`);
    }
    return onPlanningSucceeded(tx, runId, planningOutput);
  };

  let planningOutput = run.kind === 'planning' ? await storedPlanningOutput(tx, runId) : undefined;
  for (const item of items) {
    if ('runnerSeq' in item && stored.has(runnerSeqKey(item.attempt, item.runnerSeq))) continue;
    if (isTerminal(status)) {
      logger.info({ runId, type: item.body.type }, 'Run event after the run ended skipped');
      continue;
    }
    const mismatch = kindMismatch(run.kind, item.body, planningOutput !== undefined);
    const next = nextRunStatus(status, item.body);
    if (next.ok && mismatch === undefined) {
      const failure = await planningFailure(item.body);
      if (failure !== null) {
        await fail(failure);
        break;
      }
      await insert(item, next.status);
      if (item.body.type === 'planning.output') planningOutput = item.body.output;
      continue;
    }
    logger.warn({ runId, type: item.body.type, status }, 'Run event rejected by the status rules');
    await fail(
      protocolError(mismatch ?? `The runner sent ${item.body.type} while the run was ${status}.`),
    );
    break;
  }

  if (rows.length > 0) {
    await tx.insert(runEvents).values(rows);
    await tx
      .update(runs)
      .set({ lastEventId: eventId, ...(cancelRequested ? { cancelRequested: true } : {}) })
      .where(eq(runs.id, runId));
    await tx.execute(sql`SELECT pg_notify(${RUN_EVENTS_CHANNEL}, ${runId})`);
  }
  return {
    ackedSeq: await highestRunnerSeq(tx, runId, attempt),
    ended: !isTerminal(run.status) && isTerminal(status),
  };
}

/** The highest runner sequence stored for one attempt of a run, or 0. */
async function highestRunnerSeq(
  executor: Executor,
  runId: string,
  attempt: number,
): Promise<number> {
  const [row] = await executor
    .select({ seq: max(runEvents.runnerSeq) })
    .from(runEvents)
    .where(
      and(
        eq(runEvents.runId, runId),
        eq(runEvents.attempt, attempt),
        isNotNull(runEvents.runnerSeq),
      ),
    );
  return row?.seq ?? 0;
}

/** The highest stored runner sequence for each run at the given attempt, or none. */
export async function highestRunnerSeqs(
  executor: Executor,
  attempts: Map<string, number>,
): Promise<Map<string, number>> {
  if (attempts.size === 0) return new Map();
  const rows = await executor
    .select({ runId: runEvents.runId, attempt: runEvents.attempt, seq: max(runEvents.runnerSeq) })
    .from(runEvents)
    .where(and(inArray(runEvents.runId, [...attempts.keys()]), isNotNull(runEvents.runnerSeq)))
    .groupBy(runEvents.runId, runEvents.attempt);
  return new Map(
    rows.flatMap((row) =>
      attempts.get(row.runId) === row.attempt ? [[row.runId, row.seq ?? 0] as const] : [],
    ),
  );
}

/** One page of a run's events after an event id, in event id order. */
export async function readRunEvents(
  executor: Executor,
  runId: string,
  afterEventId: number,
  limit: number,
): Promise<RunEvent[]> {
  const rows = await executor
    .select({ payload: runEvents.payload })
    .from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.eventId, afterEventId)))
    .orderBy(asc(runEvents.eventId))
    .limit(limit);
  return rows.map((row) => RunEvent.parse(row.payload));
}
