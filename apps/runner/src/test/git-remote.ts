import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Repository } from '@plangineer/contracts';
import { execa } from 'execa';

const IDENTITY = ['-c', 'user.name=Plangineer Test', '-c', 'user.email=test@example.com'];

export interface GitRemote {
  /** The `file:` base URL that stands in for `https://github.com`. */
  baseUrl: string;
  /** Commits `files` on `branch`, from `main`, and pushes it, returning the commit. */
  commit(files: Record<string, string>, branch?: string): Promise<string>;
  cleanup(): Promise<void>;
}

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execa('git', args, { cwd })).stdout.trim();
}

/** A local bare repository at `<base>/<owner>/<name>.git` with a working copy that pushes to it. */
export async function createGitRemote(repository: Repository): Promise<GitRemote> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'runner-remote-'));
  const base = path.join(root, 'remote');
  const bare = path.join(base, repository.owner, `${repository.name}.git`);
  const work = path.join(root, 'work');
  await mkdir(bare, { recursive: true });
  await git(bare, ['init', '--quiet', '--bare', '--initial-branch=main']);
  await git(root, ['clone', '--quiet', bare, work]);
  await git(work, ['checkout', '--quiet', '-B', 'main']);

  return {
    baseUrl: pathToFileURL(base).href,
    async commit(files, branch = 'main') {
      await git(work, ['checkout', '--quiet', '-B', branch]);
      for (const [file, content] of Object.entries(files)) {
        const target = path.join(work, ...file.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }
      await git(work, ['add', '--all']);
      await git(work, [...IDENTITY, 'commit', '--quiet', '-m', 'Test commit']);
      await git(work, ['push', '--quiet', 'origin', branch]);
      const commit = await git(work, ['rev-parse', 'HEAD']);
      await git(work, ['checkout', '--quiet', 'main']);
      return commit;
    },
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}

/** Skill files with an in-sync mirror, so a run's skills check passes. */
export const SYNCED_SKILLS = {
  '.agents/skills/alpha/SKILL.md': 'alpha\n',
  '.claude/skills/alpha/SKILL.md': 'alpha\n',
};
