import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runnerPaths } from '../config/runner-paths.ts';
import { createGitRemote, type GitRemote } from '../test/git-remote.ts';
import { createWorktrees, type Worktrees } from './worktrees.ts';

const repository = { owner: 'Acme', name: 'App' };

let dataDir: string;
let remote: GitRemote;
let worktrees: Worktrees;
let firstCommit: string;

const clonePath = () => runnerPaths(dataDir).bareClone(repository);
const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout;

function exists(file: string): Promise<boolean> {
  return stat(file).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-data-'));
  remote = await createGitRemote(repository);
  firstCommit = await remote.commit({ 'README.md': 'first\n' });
  worktrees = createWorktrees({ paths: runnerPaths(dataDir), gitBaseUrl: remote.baseUrl });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  await remote.cleanup();
});

describe('prepareWorktree', () => {
  it('creates a detached worktree at the ref commit under the data directory', async () => {
    const runId = randomUUID();

    const worktree = await worktrees.prepareWorktree({
      repository,
      ref: 'main',
      runId,
      attempt: 1,
    });

    expect(worktree.commit).toBe(firstCommit);
    expect(worktree.path).toBe(path.join(dataDir, 'w', `${runId}-1`, 'App'));
    expect(path.relative(process.cwd(), worktree.path).startsWith('..')).toBe(true);
    expect(await git(worktree.path, 'rev-parse', 'HEAD')).toBe(firstCommit);
    expect(await git(worktree.path, 'status', '--branch', '--porcelain')).toBe(
      '## HEAD (no branch)',
    );
    expect(await readFile(path.join(worktree.path, 'README.md'), 'utf8')).toMatch(/^first\r?\n$/);
  });

  it('reuses the clone for a second run after fetching new commits', async () => {
    await worktrees.prepareWorktree({ repository, ref: 'main', runId: randomUUID(), attempt: 1 });
    const marker = path.join(clonePath(), 'plangineer-test-marker');
    await writeFile(marker, '');
    const secondCommit = await remote.commit({ 'README.md': 'second\n' });

    const worktree = await worktrees.prepareWorktree({
      repository,
      ref: 'main',
      runId: randomUUID(),
      attempt: 1,
    });

    expect(worktree.commit).toBe(secondCommit);
    expect(await exists(marker)).toBe(true);
  });

  it('serves two runs on one repository at once', async () => {
    const results = await Promise.all([
      worktrees.prepareWorktree({ repository, ref: 'main', runId: randomUUID(), attempt: 1 }),
      worktrees.prepareWorktree({ repository, ref: 'main', runId: randomUUID(), attempt: 1 }),
    ]);

    expect(results.map((result) => result.commit)).toEqual([firstCommit, firstCommit]);
  });

  it('shares one clone between names that differ only in case', async () => {
    const results = await Promise.all([
      worktrees.prepareWorktree({ repository, ref: 'main', runId: randomUUID(), attempt: 1 }),
      worktrees.prepareWorktree({
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        runId: randomUUID(),
        attempt: 1,
      }),
    ]);

    expect(results.map((result) => result.commit)).toEqual([firstCommit, firstCommit]);
    expect(await readdir(path.join(dataDir, 'repos'))).toEqual(['acme']);
    expect(await readdir(path.join(dataDir, 'repos', 'acme'))).toEqual(['app.git']);
  });

  it("fails an unknown ref with git's message", async () => {
    await expect(
      worktrees.prepareWorktree({
        repository,
        ref: 'no-such-branch',
        runId: randomUUID(),
        attempt: 1,
      }),
    ).rejects.toMatchObject({
      name: 'GitError',
      message: expect.stringContaining('fatal'),
      stderrTail: expect.arrayContaining([expect.stringContaining('fatal')]),
    });
  });

  it('fails a ref that git does not accept as a ref name', async () => {
    await expect(
      worktrees.prepareWorktree({ repository, ref: 'main.lock', runId: randomUUID(), attempt: 1 }),
    ).rejects.toMatchObject({ name: 'GitError' });
  });
});

describe('removeWorktree', () => {
  it('leaves no folder and no worktree entry in the clone', async () => {
    const runId = randomUUID();
    const worktree = await worktrees.prepareWorktree({
      repository,
      ref: 'main',
      runId,
      attempt: 1,
    });

    await worktrees.removeWorktree({ repository, runId, attempt: 1 });

    expect(await exists(path.dirname(worktree.path))).toBe(false);
    const listing = await git(clonePath(), 'worktree', 'list', '--porcelain');
    expect(listing.split(/\r?\n/).filter((line) => line.startsWith('worktree '))).toHaveLength(1);
  });

  it("keeps a retried attempt's worktree when the stopping attempt's is removed", async () => {
    const runId = randomUUID();
    const first = await worktrees.prepareWorktree({ repository, ref: 'main', runId, attempt: 1 });

    const second = await worktrees.prepareWorktree({ repository, ref: 'main', runId, attempt: 2 });
    await worktrees.removeWorktree({ repository, runId, attempt: 1 });

    expect(second.path).not.toBe(first.path);
    expect(await exists(first.path)).toBe(false);
    expect(await exists(path.join(second.path, 'README.md'))).toBe(true);
  });

  it('succeeds for a run whose checkout never started', async () => {
    await expect(
      worktrees.removeWorktree({ repository, runId: randomUUID(), attempt: 1 }),
    ).resolves.toBeUndefined();
  });
});
