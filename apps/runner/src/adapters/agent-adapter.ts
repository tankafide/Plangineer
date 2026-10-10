import type { CliStatus, RunnerRunEventBody } from '@plangineer/contracts';

/**
 * What the agent may do, which the job sets: a test, intake or exploration job only reads, a
 * research job also searches the web and fetches from GitHub, and a setup job may also create
 * and edit files under .agents/skills/ and start subagents.
 */
export type AgentAccess = 'read_only' | 'research' | 'write_skills';

/** What an adapter needs to run one job: the prompt, the worktree and the agent's access. */
export interface AgentJob {
  prompt: string;
  cwd: string;
  access: AgentAccess;
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
