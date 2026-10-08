import { setTimeout as delay } from 'node:timers/promises';
import {
  isTerminalRunEvent,
  type RunnerRunEventBody,
  RunnerPlatform,
  type RunnerToServerMessage,
  type ServerToRunnerMessage,
} from '@plangineer/contracts';
import type { AgentAdapter } from './adapters/agent-adapter.ts';
import { createClaudeCodeAdapter } from './adapters/claude-code/claude-code-adapter.ts';
import type { CommandResult } from './command-result.ts';
import { readCredentials, type RunnerCredentials } from './config/runner-credentials.ts';
import type { RunnerEnv } from './config/runner-env.ts';
import { createRunnerLogger, type Logger } from './config/runner-logger.ts';
import { runnerPaths } from './config/runner-paths.ts';
import { connectControlPlane, type SocketFatal } from './connection/control-plane-socket.ts';
import { createEventBuffer, type EventBuffer } from './jobs/event-buffer.ts';
import { createJobQueue } from './jobs/job-queue.ts';
import { createRunJob, type RunJob, type StopCause } from './jobs/run-job.ts';
import { packageVersion } from './package-version.ts';
import { createWorktrees } from './worktrees/worktrees.ts';

const FLUSH_INTERVAL_MS = 100;
/** How long shutdown waits for the server to acknowledge the stopped runs' last events. */
const SHUTDOWN_ACK_WAIT_MS = 5_000;
const NOT_PAIRED_MESSAGE = 'This runner is not paired. Run pnpm runner pair first.';
const FATAL_MESSAGES: Record<SocketFatal['kind'], string> = {
  revoked: 'This runner was revoked or its token is invalid. Pair it again with pnpm runner pair.',
  replaced:
    'Another runner process using this pairing took over. Stop that process, or pair this machine as a second runner.',
  protocol: 'The runner and the control plane disagree on the protocol, so the runner stopped.',
};

type Message<T extends ServerToRunnerMessage['type']> = Extract<ServerToRunnerMessage, { type: T }>;

interface ActiveRun {
  job: RunJob;
  buffer: EventBuffer;
}

export interface RunnerOptions {
  env: RunnerEnv;
  credentials: RunnerCredentials;
  adapter: AgentAdapter;
  logger: Logger;
}

export interface Runner {
  /** Stops every job, waits briefly for their last events to be acknowledged, then ends. */
  shutdown(): void;
  readonly exited: Promise<CommandResult>;
}

/** Connects to the control plane and runs the jobs it assigns until shutdown or a fatal close. */
export async function startRunner(options: RunnerOptions): Promise<Runner> {
  const { env, credentials, adapter, logger } = options;
  const cli = await adapter.detect();
  const runs = new Map<string, ActiveRun>();
  const worktrees = createWorktrees({
    paths: runnerPaths(env.PLANGINEER_RUNNER_DATA_DIR),
    gitBaseUrl: env.PLANGINEER_GIT_BASE_URL,
  });
  let isWelcomed = false;
  let isEnding = false;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let onRunsDrained: (() => void) | undefined;
  const { promise: exited, resolve: finish } = Promise.withResolvers<CommandResult>();

  const send = (message: RunnerToServerMessage) => socket.send(message);
  const queue = createJobQueue({
    concurrency: env.PLANGINEER_RUNNER_CONCURRENCY,
    reportPlanLimit: (planLimitResetsAt) => send({ type: 'runner.status', planLimitResetsAt }),
    onJobError: (error) => logger.error({ err: error }, 'A run failed inside the runner'),
  });

  function findRun(runId: string, attempt: number): ActiveRun | undefined {
    const run = runs.get(runId);
    return run?.job.attempt === attempt ? run : undefined;
  }

  function flush(run: ActiveRun): void {
    if (!isWelcomed || runs.get(run.job.runId) !== run) return;
    for (let batch = run.buffer.nextBatch(); batch !== null; batch = run.buffer.nextBatch()) {
      if (!send(batch)) return;
    }
  }

  function flushAll(): void {
    for (const run of runs.values()) flush(run);
  }

  /** Forgets a run once its job has finished and the server has every event. */
  function release(run: ActiveRun): void {
    if (!run.job.isFinished || !run.buffer.isDrained) return;
    runs.delete(run.job.runId);
    if (runs.size === 0) onRunsDrained?.();
  }

  function invalidate(run: ActiveRun): void {
    run.job.stop('invalid');
    runs.delete(run.job.runId);
    if (runs.size === 0) onRunsDrained?.();
  }

  function emit(run: ActiveRun, event: RunnerRunEventBody): boolean {
    const isTerminal = isTerminalRunEvent(event);
    if (run.buffer.isFull && !isTerminal) return false;
    run.buffer.append(event);
    if (isTerminal || run.buffer.hasFullBatch) flush(run);
    return true;
  }

  function assign({ runId, attempt, job }: Message<'run.assign'>): void {
    const existing = runs.get(runId);
    if (existing?.job.attempt === attempt) return;
    if (existing !== undefined) invalidate(existing);
    const buffer = createEventBuffer(runId, attempt);
    const run: ActiveRun = {
      buffer,
      job: createRunJob({
        runId,
        attempt,
        job,
        adapter,
        worktrees,
        timeoutMs: env.PLANGINEER_RUN_TIMEOUT_MS,
        emit: (event) => emit(run, event),
        onPlanLimit: (resetsAt) => queue.pause(resetsAt),
      }),
    };
    runs.set(runId, run);
    logger.info({ runId, attempt, repository: job.repository, ref: job.ref }, 'Run assigned');
    if (isEnding) run.job.stop('shutdown');
    queue.add(run.job);
  }

  function sendHeartbeats(): void {
    for (const { job } of runs.values()) {
      if (!job.isFinished) send({ type: 'run.heartbeat', runId: job.runId, attempt: job.attempt });
    }
  }

  function welcome(message: Message<'welcome'>): void {
    for (const entry of message.runs) {
      const run = findRun(entry.runId, entry.attempt);
      if (run === undefined) continue;
      if (!entry.valid) {
        invalidate(run);
        continue;
      }
      run.buffer.resendAbove(entry.ackedSeq);
      release(run);
    }
    isWelcomed = true;
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(sendHeartbeats, message.heartbeatIntervalMs);
    const planLimitResetsAt = queue.planLimitResetsAt;
    if (planLimitResetsAt !== null) send({ type: 'runner.status', planLimitResetsAt });
    flushAll();
  }

  function heartbeatReply(message: Message<'run.heartbeat_reply'>): void {
    const run = findRun(message.runId, message.attempt);
    if (run === undefined) return;
    if (!message.valid) invalidate(run);
    else if (message.cancelRequested) run.job.stop('cancel');
  }

  function handleMessage(message: ServerToRunnerMessage): void {
    switch (message.type) {
      case 'welcome':
        return welcome(message);
      case 'run.assign':
        return assign(message);
      case 'run.cancel':
        return findRun(message.runId, message.attempt)?.job.stop('cancel');
      case 'run.ack': {
        const run = findRun(message.runId, message.attempt);
        run?.buffer.acknowledge(message.seq);
        if (run !== undefined) release(run);
        return;
      }
      case 'run.heartbeat_reply':
        return heartbeatReply(message);
      default: {
        const unknownMessage: never = message;
        throw new Error(`Unknown control plane message: ${JSON.stringify(unknownMessage)}`);
      }
    }
  }

  function sendHello(): void {
    isWelcomed = false;
    clearInterval(heartbeatTimer);
    send({
      type: 'hello',
      runnerVersion: packageVersion(),
      platform: RunnerPlatform.parse(process.platform),
      concurrencyLimit: env.PLANGINEER_RUNNER_CONCURRENCY,
      clis: [cli],
      activeRuns: [...runs.values()].map(({ job }) => ({ runId: job.runId, attempt: job.attempt })),
    });
  }

  /** Stops every job and waits for their children to exit and worktrees to go. */
  async function stopJobs(cause: StopCause): Promise<void> {
    for (const { job } of runs.values()) job.stop(cause);
    await queue.whenIdle();
  }

  function end(result: CommandResult): void {
    clearInterval(flushTimer);
    clearInterval(heartbeatTimer);
    queue.close();
    socket.close();
    finish(result);
  }

  async function failFatally(fatal: SocketFatal): Promise<void> {
    logger.error({ fatal }, 'The runner is stopping');
    isEnding = true;
    await stopJobs('shutdown');
    end({ ok: false, message: FATAL_MESSAGES[fatal.kind] });
  }

  async function shutdown(): Promise<void> {
    isEnding = true;
    logger.info('Shutting down');
    await stopJobs('shutdown');
    flushAll();
    if (runs.size > 0) {
      const drained = Promise.withResolvers<void>();
      onRunsDrained = drained.resolve;
      const waitOver = new AbortController();
      await Promise.race([
        drained.promise,
        delay(SHUTDOWN_ACK_WAIT_MS, undefined, { signal: waitOver.signal }),
      ]);
      waitOver.abort();
    }
    end({ ok: true, message: 'Runner stopped.' });
  }

  const socket = connectControlPlane({
    serverUrl: credentials.serverUrl,
    token: credentials.token,
    logger,
    onOpen: sendHello,
    onMessage: handleMessage,
    onFatal: (fatal) => void failFatally(fatal),
  });
  const flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);

  return {
    shutdown() {
      if (!isEnding) void shutdown();
    },
    exited,
  };
}

/** `start`: runs the paired runner until SIGINT, SIGTERM or a close it cannot recover from. */
export async function startCommand(env: RunnerEnv): Promise<CommandResult> {
  const paths = runnerPaths(env.PLANGINEER_RUNNER_DATA_DIR);
  const credentials = await readCredentials(paths.credentials);
  if (credentials === null) return { ok: false, message: NOT_PAIRED_MESSAGE };
  const logger = createRunnerLogger(env.LOG_LEVEL, paths.logFile);
  const adapter = createClaudeCodeAdapter(env.PLANGINEER_CLAUDE_COMMAND);
  const runner = await startRunner({ env, credentials, adapter, logger });
  const onSignal = () => runner.shutdown();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    return await runner.exited;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
