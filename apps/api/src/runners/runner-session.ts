import type { RunnerToServerMessage, ServerToRunnerMessage } from '@plangineer/contracts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import {
  extendLease,
  findActiveRunsOfRunner,
  lockRunOfRunner,
} from '../runs/run-dispatch-repository.ts';
import { appendRunEvents, highestRunnerSeqs } from '../runs/run-events-repository.ts';
import { recordPlanLimit, recordRunnerHello, recordRunnerSeen } from './runner-repository.ts';

type Message<T extends RunnerToServerMessage['type']> = Extract<RunnerToServerMessage, { type: T }>;
type Reply<T extends ServerToRunnerMessage['type']> = Extract<ServerToRunnerMessage, { type: T }>;

/** Stores what the runner reported and answers which of its active runs it may keep. */
export async function acceptHello(
  { db, env }: ServiceDeps,
  runnerId: string,
  hello: Message<'hello'>,
): Promise<Reply<'welcome'>> {
  await recordRunnerHello(db, runnerId, {
    concurrencyLimit: hello.concurrencyLimit,
    runnerVersion: hello.runnerVersion,
    clis: hello.clis,
  });
  const active = await findActiveRunsOfRunner(
    db,
    runnerId,
    hello.activeRuns.map((run) => run.runId),
  );
  const acked = await highestRunnerSeqs(db, active);
  return {
    type: 'welcome',
    runnerId,
    heartbeatIntervalMs: env.RUNNER_HEARTBEAT_INTERVAL_MS,
    runs: hello.activeRuns.map(({ runId, attempt }) => {
      const valid = active.get(runId) === attempt;
      return { runId, attempt, valid, ackedSeq: valid ? (acked.get(runId) ?? 0) : 0 };
    }),
  };
}

/**
 * Stores a batch for this runner's run at its current attempt, under the run's lock, and
 * returns the sequence to acknowledge. Returns undefined, storing nothing, for a stale
 * attempt, a run that is not leased or running, or another runner's run.
 */
export async function acceptRunEvents(
  { db, env, logger }: ServiceDeps,
  runnerId: string,
  message: Message<'run.events'>,
): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    const run = await lockRunOfRunner(tx, runnerId, message.runId);
    if (
      run === undefined ||
      run.attempt !== message.attempt ||
      (run.status !== 'leased' && run.status !== 'running')
    ) {
      return undefined;
    }
    return appendRunEvents(
      tx,
      message.runId,
      message.events.map(({ seq, event }) => ({
        body: event,
        attempt: message.attempt,
        runnerSeq: seq,
      })),
      { leaseDurationMs: env.RUN_LEASE_DURATION_MS, logger },
    );
  });
}

/** Extends the lease of this runner's active attempt and reports the cancel flag. */
export async function acceptHeartbeat(
  { db, env }: ServiceDeps,
  runnerId: string,
  { runId, attempt }: Message<'run.heartbeat'>,
): Promise<Reply<'run.heartbeat_reply'>> {
  const lease = await extendLease(db, {
    runnerId,
    runId,
    attempt,
    leaseDurationMs: env.RUN_LEASE_DURATION_MS,
  });
  return {
    type: 'run.heartbeat_reply',
    runId,
    attempt,
    valid: lease !== undefined,
    cancelRequested: lease?.cancelRequested ?? false,
  };
}

export async function acceptRunnerStatus(
  { db }: ServiceDeps,
  runnerId: string,
  { planLimitResetsAt }: Message<'runner.status'>,
): Promise<void> {
  await recordPlanLimit(
    db,
    runnerId,
    planLimitResetsAt === null ? null : new Date(planLimitResetsAt),
  );
}

/** A pong from the runner: it is online. */
export async function acceptPong({ db }: ServiceDeps, runnerId: string): Promise<void> {
  await recordRunnerSeen(db, runnerId);
}
