import {
  FAILURE_MESSAGE_MAX,
  isTerminalRunEvent,
  type RunJob as RunJobSpec,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import type { AgentAdapter } from '../adapters/agent-adapter.ts';
import { checkSkillsMirror } from '../skills/skills-mirror.ts';
import { GitError } from '../worktrees/git.ts';
import type { Worktrees } from '../worktrees/worktrees.ts';

/** Why a job was stopped. The first cause wins and picks the job's terminal event. */
export type StopCause = 'cancel' | 'shutdown' | 'buffer_full' | 'timeout' | 'invalid';

export interface RunJobContext {
  runId: string;
  attempt: number;
  job: RunJobSpec;
  adapter: AgentAdapter;
  worktrees: Worktrees;
  timeoutMs: number;
  /** Takes the job's next event, or returns false when its buffer is full. */
  emit(event: RunnerRunEventBody): boolean;
  /** Called when the agent reports that its plan limit is reached. */
  onPlanLimit(resetsAt: string | null): void;
}

export interface RunJob {
  readonly runId: string;
  readonly attempt: number;
  /** Whether the job has sent its terminal event, or was stopped with none. */
  readonly isFinished: boolean;
  /** Runs the job to its end. A job stopped before it starts sends its terminal event at once. */
  run(): Promise<void>;
  stop(cause: StopCause): void;
}

type RunFailed = Extract<RunnerRunEventBody, { type: 'run.failed' }>;

function failed(
  reason: RunFailed['reason'],
  message: string,
  stderrTail: string[] = [],
): RunFailed {
  return { type: 'run.failed', reason, message, exitCode: null, stderrTail };
}

function stopEvent(cause: StopCause, timeoutMs: number): RunnerRunEventBody | null {
  switch (cause) {
    case 'cancel':
      return { type: 'run.cancelled', reason: 'requested' };
    case 'shutdown':
      return failed('runner_stopped', 'The runner stopped before the run finished.');
    case 'buffer_full':
      return failed(
        'event_buffer_full',
        'The runner holds 10,000 events the server has not acknowledged.',
      );
    case 'timeout':
      return failed('timeout', `The run passed its time limit of ${timeoutMs} ms.`);
    case 'invalid':
      return null;
    default: {
      const unknownCause: never = cause;
      throw new Error(`Unknown stop cause: ${String(unknownCause)}`);
    }
  }
}

/** One assigned run: checkout, skills check, CLI check, the agent, then worktree removal. */
export function createRunJob(context: RunJobContext): RunJob {
  const { runId, attempt, job, adapter, worktrees, timeoutMs } = context;
  const controller = new AbortController();
  let stopCause: StopCause | null = null;
  let started = false;
  let finished = false;

  /** Ends the job with its one terminal event, or with none for a run the server moved on. */
  function finishWith(event: RunnerRunEventBody | null): void {
    if (finished) return;
    finished = true;
    if (event !== null) context.emit(event);
  }

  /** Sends an event. Once the job is stopping, its stop cause picks the terminal event instead. */
  function send(event: RunnerRunEventBody): void {
    if (finished) return;
    if (isTerminalRunEvent(event)) {
      if (stopCause === null) finishWith(event);
      return;
    }
    if (!context.emit(event)) {
      stop('buffer_full');
      return;
    }
    if (event.type === 'agent.rate_limit' && event.status === 'rejected') {
      context.onPlanLimit(event.resetsAt);
    }
  }

  function sendStopEvent(): void {
    if (stopCause !== null) finishWith(stopEvent(stopCause, timeoutMs));
  }

  function stop(cause: StopCause): void {
    if (stopCause !== null || finished) return;
    stopCause = cause;
    controller.abort(cause);
    if (!started) sendStopEvent();
  }

  async function runAgent(): Promise<void> {
    const repository = job.repository;
    let worktree: { path: string; commit: string };
    try {
      worktree = await worktrees.prepareWorktree({ repository, ref: job.ref, runId, attempt });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      send(
        failed('checkout_failed', error.message.slice(0, FAILURE_MESSAGE_MAX), error.stderrTail),
      );
      return;
    }
    if (controller.signal.aborted) return;
    const drift = await checkSkillsMirror(worktree.path);
    if (!drift.ok) return send(failed('skills_drift', drift.message));
    const cli = await adapter.detect();
    if (!cli.available || cli.version === null) {
      const found = cli.version === null ? 'no version' : cli.version;
      return send(
        failed(
          'cli_unavailable',
          `Claude Code ${cli.minimumVersion} or later is needed, found ${found}.`,
        ),
      );
    }
    if (controller.signal.aborted) return;
    send({
      type: 'run.started',
      commit: worktree.commit,
      cli: { name: cli.name, version: cli.version },
    });
    const agentJob = { prompt: job.prompt, cwd: worktree.path, permissionMode: job.permissionMode };
    for await (const event of adapter.run(agentJob, controller.signal)) send(event);
  }

  async function run(): Promise<void> {
    if (finished) return;
    started = true;
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    try {
      await runAgent();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      send(
        failed(
          'runner_stopped',
          `The runner failed this run: ${reason}`.slice(0, FAILURE_MESSAGE_MAX),
        ),
      );
      throw error;
    } finally {
      clearTimeout(timer);
      sendStopEvent();
      await worktrees.removeWorktree({ repository: job.repository, runId, attempt });
    }
  }

  return {
    runId,
    attempt,
    get isFinished() {
      return finished;
    },
    run,
    stop,
  };
}
