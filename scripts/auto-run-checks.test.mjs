import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answer,
  commitAll,
  createRepos,
  PLAN_PATH,
  planFixReport,
  planReport,
  quietResults,
  reviewReport,
} from './auto-run-test-kit.mjs';

const planWrites = (writes) =>
  quietResults({ plan: [answer(planReport(), { writes, commit: true })] });

/** Each run starts a dozen processes per session, which takes seconds on Windows. */
describe('autoRun checks after each session', { timeout: 60_000 }, () => {
  let repos;

  beforeEach(async () => {
    repos = await createRepos();
  });

  afterEach(async () => {
    await repos.remove();
  });

  it('commits what a fake answer writes and leaves a clean tree', async () => {
    await repos.run(quietResults());

    expect(await repos.commitOf('plan 1')).toMatch(/^[0-9a-f]{40}$/);
    expect(await readFile(path.join(repos.worktree, PLAN_PATH), 'utf8')).toBe('# Thing\n');
    const { stdout } = await execa('git', ['status', '--porcelain'], { cwd: repos.worktree });
    expect(stdout).toBe('');
  });

  it('fails a session that leaves uncommitted files, naming the step and each file', async () => {
    const results = quietResults({
      'implementation-review': [
        answer(reviewReport([]), { writes: { 'src/a.ts': 'a', 'src/b.ts': 'b' } }),
      ],
    });

    await expect(repos.run(results)).rejects.toThrow(
      'The implementation-review-1 session left uncommitted changes: src/a.ts, src/b.ts',
    );
  });

  it('fails a plan session that commits a file outside docs/', async () => {
    await expect(
      repos.run(planWrites({ [PLAN_PATH]: '# Thing\n', 'src/thing.ts': 'x' })),
    ).rejects.toThrow('The plan session changed files outside docs/: src/thing.ts');
  });

  it('fails a plan session that moves a file into docs/', async () => {
    await writeFile(path.join(repos.worktree, 'notes.md'), 'Notes\n');
    await commitAll(repos.worktree, 'Add notes');

    await expect(
      repos.run(planWrites({ 'notes.md': null, 'docs/notes.md': 'Notes\n' })),
    ).rejects.toThrow('The plan session changed files outside docs/: notes.md');
  });

  it('fails a plan fix that commits a file outside docs/', async () => {
    const results = quietResults({
      'plan-review': [answer(reviewReport(['First']))],
      'plan-fix': [
        answer(planFixReport({ valid: 1 }), { writes: { 'src/fix.ts': 'x' }, commit: true }),
      ],
    });

    await expect(repos.run(results)).rejects.toThrow(
      'The plan-fix-1 session changed files outside docs/: src/fix.ts',
    );
  });

  it('fails a review session that commits, naming the session and its commit', async () => {
    const results = quietResults({
      'plan-review': [answer(reviewReport([]), { writes: { 'docs/x.md': 'x' }, commit: true })],
    });

    await expect(repos.run(results)).rejects.toThrow(
      /^The plan-review-1 session made commits: [0-9a-f]+ plan-review 1$/,
    );
  });

  it('fails a fix whose verdicts do not cover every finding in the file', async () => {
    const results = quietResults({
      'plan-review': [answer(reviewReport(['First', 'Second', 'Third']))],
      'plan-fix': [answer(planFixReport({ valid: 1, invalid: 1 }), { commit: true })],
    });

    await expect(repos.run(results)).rejects.toThrow(
      'The plan-fix-1 session judged 2 findings, the file holds 3',
    );
  });
});

describe('autoRun refuses to start', () => {
  let repos;

  beforeEach(async () => {
    repos = await createRepos();
  });

  afterEach(async () => {
    await repos.remove();
  });

  it('in the main checkout', async () => {
    await expect(repos.run({}, { request: 'x', cwd: repos.main })).rejects.toThrow(
      'Run auto-run from a linked worktree',
    );
  });

  it('on a detached HEAD', async () => {
    await execa('git', ['switch', '--quiet', '--detach'], { cwd: repos.worktree });

    await expect(repos.run({})).rejects.toThrow('The worktree has a detached HEAD');
  });

  it('with uncommitted changes', async () => {
    await writeFile(path.join(repos.worktree, 'stray.txt'), 'x');

    await expect(repos.run({})).rejects.toThrow('The working tree has uncommitted changes');
    expect(await repos.calls()).toEqual([]);
  });
});
