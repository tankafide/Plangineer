import path from 'node:path';
import type { Repository } from '@plangineer/contracts';

/** Where the runner keeps its files under its data directory. */
export interface RunnerPaths {
  credentials: string;
  logFile: string;
  /** The bare clone of a repository, with folder names lowercased since GitHub ignores case. */
  bareClone(repository: Repository): string;
  /**
   * The folder holding one attempt's worktree. Keyed by attempt as well as run, so a retried
   * run never meets the worktree its stopping attempt still holds. The short `w` keeps Windows
   * paths short.
   */
  runFolder(runId: string, attempt: number): string;
  worktree(runId: string, attempt: number, repository: Repository): string;
}

export function runnerPaths(dataDir: string): RunnerPaths {
  const runFolder = (runId: string, attempt: number) =>
    path.join(dataDir, 'w', `${runId}-${attempt}`);
  return {
    credentials: path.join(dataDir, 'runner.json'),
    logFile: path.join(dataDir, 'logs', 'runner.log'),
    bareClone: ({ owner, name }) =>
      path.join(dataDir, 'repos', owner.toLowerCase(), `${name.toLowerCase()}.git`),
    runFolder,
    worktree: (runId, attempt, { name }) => path.join(runFolder(runId, attempt), name),
  };
}
