import type { CliStatus, PermissionMode, RunnerRunEventBody } from '@plangineer/contracts';

/** What an adapter needs to run one job: the prompt, the worktree and the permission mode. */
export interface AgentJob {
  prompt: string;
  cwd: string;
  permissionMode: PermissionMode;
}

/**
 * One agent CLI. Claude Code is the first, and Codex follows behind this same interface. Nothing
 * outside an adapter knows its CLI's flags or output shape.
 */
export interface AgentAdapter {
  readonly name: 'claude-code';
  detect(): Promise<CliStatus>;
  /**
   * Runs the CLI and yields its events. Run to completion it yields exactly one terminal event.
   * When `signal` aborts, it stops the CLI and ends without one, since the caller knows why.
   */
  run(job: AgentJob, signal: AbortSignal): AsyncIterable<RunnerRunEventBody>;
}
