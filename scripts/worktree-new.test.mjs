import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorktree } from './worktree-new.mjs';

const COMMIT = ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm'];

describe('createWorktree', () => {
  let root;
  let main;
  let installed;
  const install = async (dir) => {
    installed.push(dir);
  };

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'worktree-new-')));
    main = path.join(root, 'main');
    installed = [];
    await execa('git', ['init', '--quiet', '--bare', '--initial-branch=main', 'origin.git'], {
      cwd: root,
    });
    await execa('git', ['clone', '--quiet', path.join(root, 'origin.git'), main]);
    await writeFile(path.join(main, '.gitignore'), '.env\n');
    await execa('git', ['add', '.gitignore'], { cwd: main });
    await execa('git', [...COMMIT, 'init'], { cwd: main });
    await execa('git', ['push', '--quiet', 'origin', 'main'], { cwd: main });
    await execa('git', ['remote', 'set-head', 'origin', 'main'], { cwd: main });
    await writeFile(path.join(main, '.env'), 'API_PORT=3000\n');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('creates a new branch from origin beside the checkout, with .env, then installs', async () => {
    const worktree = await createWorktree({ cwd: main, branch: 'docs/thing', install });

    expect(worktree).toBe(path.join(root, 'main.worktrees', 'thing'));
    expect(await readFile(path.join(worktree, '.env'), 'utf8')).toBe('API_PORT=3000\n');
    const { stdout } = await execa('git', ['branch', '--show-current'], { cwd: worktree });
    expect(stdout).toBe('docs/thing');
    expect(installed).toEqual([worktree]);
  });

  it('checks out a branch that exists only on origin', async () => {
    await execa('git', ['switch', '--quiet', '-c', 'feat/old'], { cwd: main });
    await execa('git', [...COMMIT, 'old', '--allow-empty'], { cwd: main });
    await execa('git', ['push', '--quiet', 'origin', 'feat/old'], { cwd: main });
    await execa('git', ['switch', '--quiet', 'main'], { cwd: main });
    await execa('git', ['branch', '--quiet', '-D', 'feat/old'], { cwd: main });

    const worktree = await createWorktree({ cwd: main, branch: 'feat/old', install });

    const { stdout } = await execa('git', ['log', '-1', '--format=%s'], { cwd: worktree });
    expect(stdout).toBe('old');
  });

  it('fails before creating anything when the checkout has no .env', async () => {
    await rm(path.join(main, '.env'));

    await expect(createWorktree({ cwd: main, branch: 'docs/thing', install })).rejects.toThrow(
      /\.env is missing/,
    );
    expect(installed).toEqual([]);
  });

  it('rejects a missing or invalid branch name', async () => {
    await expect(createWorktree({ cwd: main, branch: undefined, install })).rejects.toThrow(
      /Usage/,
    );
    await expect(createWorktree({ cwd: main, branch: 'bad..name', install })).rejects.toThrow(
      /check-ref-format/,
    );
  });
});
