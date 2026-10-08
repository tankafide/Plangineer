import path from 'node:path';
import type { Repository } from '@plangineer/contracts';

/** Where the runner keeps its files under its data directory. */
export interface RunnerPaths {
  credentials: string;
  logFile: string;
  /** The bare clone of a repository, with folder names lowercased since GitHub ignores case. */
  bareClone(repository: Repository): string;
  /** The folder holding one run's worktree. The short `w` keeps Windows paths short. */
  runFolder(runId: string): string;
  worktree(runId: string, repository: Repository): string;
}

export function runnerPaths(dataDir: string): RunnerPaths {
  const runFolder = (runId: string) => path.join(dataDir, 'w', runId);
  return {
    credentials: path.join(dataDir, 'runner.json'),
    logFile: path.join(dataDir, 'logs', 'runner.log'),
    bareClone: ({ owner, name }) =>
      path.join(dataDir, 'repos', owner.toLowerCase(), `${name.toLowerCase()}.git`),
    runFolder,
    worktree: (runId, { name }) => path.join(runFolder(runId), name),
  };
}
