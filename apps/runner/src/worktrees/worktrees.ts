import { access, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Repository } from '@plangineer/contracts';
import type { RunnerPaths } from '../config/runner-paths.ts';
import { git } from './git.ts';

interface WorktreeRequest {
  repository: Repository;
  ref: string;
  runId: string;
  attempt: number;
}

export interface Worktrees {
  /** Checks out `ref` at its commit in a detached worktree for the attempt, from a fetched clone. */
  prepareWorktree(request: WorktreeRequest): Promise<{ path: string; commit: string }>;
  /** Removes the attempt's worktree folder, then prunes its entry from the clone. */
  removeWorktree(request: Omit<WorktreeRequest, 'ref'>): Promise<void>;
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Worktrees under the runner's data directory, never inside the engineer's checkout. Each
 * repository has one bare clone, and its git commands run one at a time, since parallel
 * `worktree add` calls race on the clone's lock files.
 */
export function createWorktrees(options: { paths: RunnerPaths; gitBaseUrl: string }): Worktrees {
  const { paths, gitBaseUrl } = options;
  const chains = new Map<string, Promise<unknown>>();

  /** Runs `task` after every earlier task on the same repository, whatever their outcome. */
  function serialize<T>(repository: Repository, task: () => Promise<T>): Promise<T> {
    const key = `${repository.owner}/${repository.name}`.toLowerCase();
    const previous = chains.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, settled);
    void settled.then(() => {
      if (chains.get(key) === settled) chains.delete(key);
    });
    return next;
  }

  async function ensureClone(repository: Repository): Promise<string> {
    const clone = paths.bareClone(repository);
    if (!(await exists(clone))) {
      await mkdir(path.dirname(clone), { recursive: true });
      const url = `${gitBaseUrl}/${repository.owner}/${repository.name}.git`;
      await git(path.dirname(clone), ['clone', '--bare', '--', url, clone]);
      await git(clone, ['config', 'core.longpaths', 'true']);
      await git(clone, ['config', 'remote.origin.fetch', '+refs/heads/*:refs/heads/*']);
    }
    return clone;
  }

  async function prepare(request: WorktreeRequest): Promise<{ path: string; commit: string }> {
    await git(process.cwd(), ['check-ref-format', '--allow-onelevel', request.ref]);
    const clone = await ensureClone(request.repository);
    await git(clone, ['fetch', '--prune', '--tags', 'origin']);
    const commit = await git(clone, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${request.ref}^{commit}`,
    ]);
    const worktree = paths.worktree(request.runId, request.attempt, request.repository);
    await mkdir(path.dirname(worktree), { recursive: true });
    await git(clone, ['worktree', 'add', '--detach', worktree, commit]);
    return { path: worktree, commit };
  }

  async function remove(request: Omit<WorktreeRequest, 'ref'>): Promise<void> {
    await rm(paths.runFolder(request.runId, request.attempt), {
      recursive: true,
      force: true,
      maxRetries: 5,
    });
    const clone = paths.bareClone(request.repository);
    if (await exists(clone)) await git(clone, ['worktree', 'prune']);
  }

  return {
    prepareWorktree: (request) => serialize(request.repository, () => prepare(request)),
    removeWorktree: (request) => serialize(request.repository, () => remove(request)),
  };
}
