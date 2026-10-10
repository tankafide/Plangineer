import type { PlanningOutput, RunnerRunEventBody } from '@plangineer/contracts';
import { asc, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.ts';
import { runEvents, runs } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { applyPlanningOutput } from '../planning/planning-apply.ts';
import { appendRunEvents } from '../runs/run-events-repository.ts';
import { createRun } from '../runs/run-service.ts';

const COMMIT = 'a'.repeat(40);

export const startedEvent: RunnerRunEventBody = {
  type: 'run.started',
  commit: COMMIT,
  cli: { name: 'claude-code', version: '2.1.284' },
};

export const messageEvent = (text = 'Hello'): RunnerRunEventBody => ({
  type: 'agent.message',
  text,
  truncated: false,
  parentToolUseId: null,
});

export const succeededEvent: RunnerRunEventBody = {
  type: 'run.succeeded',
  resultText: 'Done',
  truncated: false,
  costUsd: 0.01,
  durationMs: 1_000,
  numTurns: 1,
};

export const planningOutputEvent = (output: PlanningOutput): RunnerRunEventBody => ({
  type: 'planning.output',
  output,
});

/** Queues a run through the service and returns its id. */
export async function queueRun(deps: ServiceDeps, userId: string, runnerId: string) {
  const result = await createRun(deps, userId, {
    runnerId,
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'List the files.',
  });
  if (!result.ok) throw new Error(`createRun failed: ${result.error}`);
  return result.value.id;
}

export async function runRow(db: Database, runId: string) {
  const [row] = await db.select().from(runs).where(eq(runs.id, runId));
  if (row === undefined) throw new Error(`Run ${runId} not found`);
  return row;
}

export async function storedEvents(db: Database, runId: string) {
  return db
    .select({
      eventId: runEvents.eventId,
      type: runEvents.type,
      attempt: runEvents.attempt,
      runnerSeq: runEvents.runnerSeq,
      payload: runEvents.payload,
    })
    .from(runEvents)
    .where(eq(runEvents.runId, runId))
    .orderBy(asc(runEvents.eventId));
}

/**
 * Appends runner events at the run's current attempt, numbered from firstSeq, applying a
 * planning output as the runner socket does.
 */
export async function appendRunnerEvents(
  deps: ServiceDeps,
  runId: string,
  bodies: RunnerRunEventBody[],
  firstSeq = 1,
) {
  const { attempt } = await runRow(deps.db, runId);
  const options = { leaseDurationMs: deps.env.RUN_LEASE_DURATION_MS, logger: deps.logger };
  return deps.db.transaction((tx) =>
    appendRunEvents(
      tx,
      runId,
      bodies.map((body, index) => ({ body, attempt, runnerSeq: firstSeq + index })),
      {
        ...options,
        onPlanningSucceeded: applyPlanningOutput,
      },
    ),
  );
}

/** Moves a run's lease into the past, as if its runner stopped heartbeating. */
export async function lapseLease(db: Database, runId: string): Promise<void> {
  await db
    .update(runs)
    .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
    .where(eq(runs.id, runId));
}
