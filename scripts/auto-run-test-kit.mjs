/**
 * What the auto-run tests share: a temp main checkout with a bare `origin` and a linked worktree,
 * the fake Claude's answers and records, and report factories.
 */
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { autoRun } from './auto-run.mjs';
import { repoRoot } from './script-entry.mjs';

const FAKE_CLAUDE = path.join(repoRoot, 'scripts/auto-run-fake-claude.mjs');

export const PLAN_PATH = 'docs/plans/2026-10-08-thing.md';

export const planReport = (overrides = {}) => ({
  outcome: 'done',
  branch: 'feat/thing',
  commits: ['abc1234 Plan the thing'],
  decisions: [],
  engineerActions: [],
  planPath: PLAN_PATH,
  ...overrides,
});

const checks = (failed = []) => ({ passed: ['pnpm verify'], failed, notRun: [] });

export const implementationReport = (overrides = {}) => ({
  outcome: 'done',
  branch: 'feat/thing',
  commits: ['def5678 Build the thing'],
  decisions: [],
  engineerActions: [],
  checks: checks(),
  deviations: [],
  ...overrides,
});

export const finding = (claim) => ({
  location: 'scripts/thing.mjs:1',
  claim,
  suggestedChange: 'Change it.',
  sourceSkill: 'code-quality',
  kind: 'defect',
  severity: 'should fix',
});

export const reviewReport = (claims, planAudit = null) => ({
  outcome: 'done',
  findings: claims.map((claim) => finding(claim)),
  planAudit,
});

export const planFixReport = ({ valid, invalid = 0, fixed = valid, ...overrides }) => ({
  outcome: 'done',
  valid,
  invalid,
  fixed,
  decisions: [],
  engineerActions: [],
  ...overrides,
});

export const implementationFixReport = ({ failed, ...counts }) => ({
  ...planFixReport(counts),
  checks: checks(failed),
});

const success = (report) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output: { report },
});

/** One answer of the fake: a session ending with report, after it writes and commits files. */
export const answer = (report, { writes, commit } = {}) => ({
  event: report === null ? null : success(report),
  writes,
  commit,
});

/** A run that plans, builds and finds nothing in either review. */
export const quietResults = (overrides = {}) => ({
  plan: [answer(planReport(), { writes: { [PLAN_PATH]: '# Thing\n' }, commit: true })],
  'plan-review': [answer(reviewReport([]))],
  implementation: [
    answer(implementationReport(), { writes: { 'src/thing.ts': 'x\n' }, commit: true }),
  ],
  'implementation-review': [answer(reviewReport([]))],
  ...overrides,
});

const git = async (cwd, ...args) => (await execa('git', args, { cwd })).stdout.trim();

/** Stages every change in cwd and commits it. */
export async function commitAll(cwd, message) {
  await git(cwd, 'add', '--all');
  await git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message);
}

/** Creates the temp repositories, and returns the helpers a test runs and inspects them with. */
export async function createRepos() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-run-')));
  const main = path.join(root, 'main');
  const origin = path.join(root, 'origin.git');
  const worktree = path.join(root, 'main.worktrees', 'thing');
  const configFile = path.join(root, 'fake', 'config.json');
  const recordFile = path.join(root, 'fake', 'calls.jsonl');

  await mkdir(main);
  await git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  await git(main, 'init', '--quiet', '--initial-branch=main');
  await writeFile(path.join(main, '.gitignore'), 'logs/\n');
  await commitAll(main, 'init');
  await git(main, 'remote', 'add', 'origin', origin);
  await git(main, 'push', '--quiet', 'origin', 'main');
  await git(main, 'remote', 'set-head', 'origin', '--auto');
  await git(main, 'worktree', 'add', '--quiet', '-b', 'feat/thing', worktree);

  async function run(results, options = { request: 'Add a thing.' }) {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({ recordFile, results }));
    return autoRun({
      command: [process.execPath, FAKE_CLAUDE, configFile],
      cwd: worktree,
      planRounds: 1,
      implementationRounds: 1,
      ...options,
    });
  }

  async function calls() {
    const text = await readFile(recordFile, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async function runDir() {
    const [dir] = await readdir(path.join(main, 'logs', 'auto'));
    return path.join(main, 'logs', 'auto', dir);
  }

  return {
    main,
    worktree,
    run,
    calls,
    runDir,
    head: () => git(worktree, 'rev-parse', 'HEAD'),
    commitOf: (subject) => git(worktree, 'log', '--format=%H', `--grep=^${subject}$`),
    mergeBase: () => git(main, 'rev-parse', 'origin/main'),
    remove: () => rm(root, { recursive: true, force: true, maxRetries: 5 }),
  };
}
