import {
  isTerminalRunEvent,
  type RunJob as RunJobSpec,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import type { AgentAccess, AgentAdapter } from '../adapters/agent-adapter.ts';
import type { ServerFiles } from '../connection/server-files.ts';
import { packageVersion } from '../package-version.ts';
import { finishPlanning, preparePlanning } from '../planning/planning-job.ts';
import { finishPrePlanning, preparePrePlanning } from '../pre-planning/pre-planning-job.ts';
import { finishSetup, prepareSetup } from '../setup/setup-job.ts';
import type { SkillSnapshot } from '../setup/setup-tree.ts';
import { checkSkillsMirror } from '../skills/skills-mirror.ts';
import { GitError } from '../worktrees/git.ts';
import type { Worktrees } from '../worktrees/worktrees.ts';
import { runFailed } from './run-failed.ts';

/** Why a job was stopped. The first cause wins and picks the job's terminal event. */
export type StopCause = 'cancel' | 'shutdown' | 'buffer_full' | 'timeout' | 'invalid';

export interface RunJobContext {
  runId: string;
  attempt: number;
  job: RunJobSpec;
  adapter: AgentAdapter;
  worktrees: Worktrees;
  serverFiles: ServerFiles;
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

function stopEvent(cause: StopCause, timeoutMs: number): RunnerRunEventBody | null {
  switch (cause) {
    case 'cancel':
      return { type: 'run.cancelled', reason: 'requested' };
    case 'shutdown':
      return runFailed('runner_stopped', 'The runner stopped before the run finished.');
    case 'buffer_full':
      return runFailed(
        'event_buffer_full',
        'The runner holds 10,000 events the server has not acknowledged.',
      );
    case 'timeout':
      return runFailed('timeout', `The run passed its time limit of ${timeoutMs} ms.`);
    case 'invalid':
      return null;
    default: {
      const unknownCause: never = cause;
      throw new Error(`Unknown stop cause: ${String(unknownCause)}`);
    }
  }
}

/**
 * A setup job writes skills, a research task reaches the web, a planning job writes its output
 * file, and every other job only reads.
 */
function accessFor(job: RunJobSpec): AgentAccess {
  switch (job.kind) {
    case 'setup':
      return 'write_skills';
    case 'planning':
      return 'write_plan';
    case 'pre_planning':
      return job.task === 'research' ? 'research' : 'read_only';
    case 'test':
      return 'read_only';
    default: {
      const unknownJob: never = job;
      throw new Error(`Unknown job kind: ${JSON.stringify(unknownJob)}`);
    }
  }
}

/** What the worktree holds for the agent once its job kind is ready. */
interface Prepared {
  /** The skill tree a setup job started from, or null for every other job. */
  snapshot: SkillSnapshot | null;
  systemPromptFile: string | null;
}

/**
 * One assigned run: checkout, the skills check, the setup files or the task folder, the CLI
 * check, the agent, the setup push, the answer check or the planning output, then worktree
 * removal.
 */
export function createRunJob(context: RunJobContext): RunJob {
  const { runId, attempt, job, adapter, worktrees, serverFiles, timeoutMs } = context;
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

  /**
   * Readies the worktree for the job's kind. A setup job skips the mirror check, since setup is
   * what repairs the mirror, and writes its files before the agent runs. A pre-planning or
   * planning job writes its task folder after the check.
   */
  async function prepareKind(worktree: {
    path: string;
    commit: string;
  }): Promise<Prepared | 'failed'> {
    if (job.kind === 'setup') {
      const prepared = await prepareSetup(worktree.path, job);
      if (prepared.ok) return { snapshot: prepared.value, systemPromptFile: null };
      send(prepared.event);
      return 'failed';
    }
    const drift = await checkSkillsMirror(worktree.path);
    if (!drift.ok) {
      send(runFailed('skills_drift', drift.message));
      return 'failed';
    }
    if (job.kind === 'planning') {
      const prepared = await preparePlanning(
        worktree.path,
        job,
        (destination, signal) => serverFiles.planningInputs(runId, destination, signal),
        controller.signal,
      );
      if (prepared.ok) return { snapshot: null, systemPromptFile: prepared.systemPromptFile };
      send(prepared.event);
      return 'failed';
    }
    if (job.kind !== 'pre_planning') return { snapshot: null, systemPromptFile: null };
    const failure = await preparePrePlanning(
      worktree.path,
      worktree.commit,
      job,
      serverFiles,
      controller.signal,
    );
    if (failure === null) return { snapshot: null, systemPromptFile: null };
    send(failure);
    return 'failed';
  }

  /**
   * Runs the agent. A setup job holds back its success until the branch is pushed, a
   * pre-planning job until its answer is checked, and a planning job until its output is sent.
   */
  async function runAgentTo(worktree: string, prepared: Prepared): Promise<void> {
    let succeeded: Extract<RunnerRunEventBody, { type: 'run.succeeded' }> | null = null;
    for await (const event of adapter.run(
      {
        prompt: job.prompt,
        cwd: worktree,
        access: accessFor(job),
        systemPromptFile: prepared.systemPromptFile,
      },
      controller.signal,
    )) {
      if (job.kind !== 'test' && event.type === 'run.succeeded') succeeded = event;
      else send(event);
    }
    if (succeeded === null || controller.signal.aborted) return;
    if (job.kind === 'pre_planning') return send(finishPrePlanning(succeeded));
    if (job.kind === 'planning') {
      const output = await finishPlanning(worktree, job);
      send(output);
      if (output.type === 'planning.output') send(succeeded);
      return;
    }
    const { snapshot } = prepared;
    if (job.kind !== 'setup' || snapshot === null) return;
    const published = await finishSetup(worktree, job, snapshot, packageVersion());
    if (!published.ok) return send(published.event);
    send(published.value);
    send(succeeded);
  }

  async function runAgent(): Promise<void> {
    const repository = job.repository;
    const ref = job.kind === 'setup' ? job.commit : job.ref;
    let worktree: { path: string; commit: string };
    try {
      worktree = await worktrees.prepareWorktree({ repository, ref, runId, attempt });
    } catch (error) {
      if (!(error instanceof GitError)) throw error;
      send(runFailed('checkout_failed', error.message, error.stderrTail));
      return;
    }
    if (controller.signal.aborted) return;
    const prepared = await prepareKind(worktree);
    if (prepared === 'failed') return;
    const cli = await adapter.detect();
    if (!cli.available || cli.version === null) {
      const found = cli.version === null ? 'no version' : cli.version;
      return send(
        runFailed(
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
    await runAgentTo(worktree.path, prepared);
  }

  async function run(): Promise<void> {
    if (finished) return;
    started = true;
    const timer = setTimeout(() => stop('timeout'), timeoutMs);
    try {
      await runAgent();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      send(runFailed('runner_stopped', `The runner failed this run: ${reason}`));
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
