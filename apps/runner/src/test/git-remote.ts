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
  /**
   * Commits a symbolic link at `file` pointing to `target` on `branch`, from `main`, and pushes
   * it. The link goes into Git's index only, so no link is created on disk.
   */
  commitLink(file: string, target: string, branch: string): Promise<string>;
  /** The commit a branch points at in the bare repository, or null when it has none. */
  branchCommit(branch: string): Promise<string | null>;
  /** The files on a branch of the bare repository, with their text. */
  files(branch: string): Promise<Record<string, string>>;
  /** Sets a config value on the bare repository, such as one that makes it refuse a push. */
  config(key: string, value: string): Promise<void>;
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
    async commitLink(file, target, branch) {
      await git(work, ['checkout', '--quiet', '-B', branch]);
      const blob = (
        await execa('git', ['hash-object', '-w', '--stdin'], { cwd: work, input: target })
      ).stdout.trim();
      await git(work, ['update-index', '--add', '--cacheinfo', `120000,${blob},${file}`]);
      await git(work, [...IDENTITY, 'commit', '--quiet', '-m', 'Test link']);
      await git(work, ['push', '--quiet', 'origin', branch]);
      const commit = await git(work, ['rev-parse', 'HEAD']);
      await git(work, ['checkout', '--quiet', 'main']);
      return commit;
    },
    async branchCommit(branch) {
      const result = await execa(
        'git',
        ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
        {
          cwd: bare,
          reject: false,
        },
      );
      return result.exitCode === 0 ? result.stdout.trim() : null;
    },
    async files(branch) {
      const paths = (await git(bare, ['ls-tree', '-r', '--name-only', branch])).split('\n');
      const entries = await Promise.all(
        paths.map(async (file) => {
          const shown = await execa('git', ['show', `${branch}:${file}`], {
            cwd: bare,
            stripFinalNewline: false,
          });
          return [file, shown.stdout] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    async config(key, value) {
      await git(bare, ['config', key, value]);
    },
    cleanup: () => rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}

/** Skill files with an in-sync mirror, so a run's skills check passes. */
export const SYNCED_SKILLS = {
  '.agents/skills/alpha/SKILL.md': 'alpha\n',
  '.claude/skills/alpha/SKILL.md': 'alpha\n',
};

/** A skill only under .claude/skills/, which a setup job moves to .agents/skills/. */
export const CLAUDE_ONLY_SKILLS = {
  '.claude/skills/legacy/SKILL.md': '---\nname: legacy\ndescription: Old rules.\n---\n\n# Legacy\n',
  '.claude/skills/legacy/notes.md': 'Notes that move with it.\n',
};
