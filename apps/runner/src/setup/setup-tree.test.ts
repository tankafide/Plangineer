import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refuseLinkedPaths, SetupOutputError } from './setup-tree.ts';

/** A directory link: a junction on Windows, which needs no extra rights, and a symlink elsewhere. */
const linkDirectory = (target: string, link: string) => symlink(target, link, 'junction');

describe('refuseLinkedPaths', () => {
  let worktree: string;
  let outside: string;

  beforeEach(async () => {
    worktree = await mkdtemp(path.join(os.tmpdir(), 'setup-worktree-'));
    outside = await mkdtemp(path.join(os.tmpdir(), 'setup-outside-'));
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true, maxRetries: 5 });
    await rm(outside, { recursive: true, force: true, maxRetries: 5 });
  });

  it('passes a worktree with real folders', async () => {
    await mkdir(path.join(worktree, '.agents', 'skills', 'testing'), { recursive: true });

    await expect(refuseLinkedPaths(worktree)).resolves.toBeUndefined();
  });

  it.each([
    ['.agents', ['.agents']],
    ['.agents/skills', ['.agents', 'skills']],
    ['.claude/skills', ['.claude', 'skills']],
    ['.github/workflows', ['.github', 'workflows']],
    ['a skill folder', ['.agents', 'skills', 'testing']],
  ])('refuses a checkout whose %s is a link, writing nothing', async (_name, parts) => {
    const link = path.join(worktree, ...parts);
    await mkdir(path.dirname(link), { recursive: true });
    await linkDirectory(outside, link);

    await expect(refuseLinkedPaths(worktree)).rejects.toBeInstanceOf(SetupOutputError);
    expect(await readdir(outside)).toEqual([]);
  });
});
