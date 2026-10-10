import { checkoutEntry } from '../setup/setup-tree.ts';
import { type RunFailed, runFailed } from './run-failed.ts';

/** The folder the runner writes a task's inputs into, outside Git's history. */
export const TASK_DIR = '.plangineer-task';

/**
 * Fails a checkout that already holds the task folder, as a file, a folder or a link, since the
 * runner's writes would then land in the repository's own files or outside the worktree.
 */
export async function refuseTaskFolder(worktree: string): Promise<RunFailed | null> {
  if ((await checkoutEntry(worktree, TASK_DIR)) === null) return null;
  return runFailed('checkout_failed', `The repository holds ${TASK_DIR}, which the runner owns.`);
}
