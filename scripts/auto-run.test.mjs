import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoRun, OUTCOME_FILE } from './auto-run.mjs';
import { repoRoot } from './script-entry.mjs';

const FAKE_CLAUDE = path.join(repoRoot, 'scripts/auto-run-fake-claude.mjs');

const planReport = {
  outcome: 'done',
  branch: 'feat/thing',
  commits: ['abc1234 Plan the thing'],
  reviewRounds: ['Round 1: 2 fixed, 0 skipped, 1 dropped'],
  decisions: [],
  engineerActions: [],
  planPath: 'docs/plans/2026-10-08-thing.md',
};

const implementationReport = {
  ...planReport,
  commits: ['def5678 Build the thing'],
  checks: { passed: ['pnpm verify'], failed: [], notRun: [] },
  deviations: [],
};
delete implementationReport.planPath;

const success = (report) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output: { report },
});

describe('autoRun', () => {
  let root;
  let main;
  let worktree;
  let configFile;
  let recordFile;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-run-')));
    main = path.join(root, 'main');
    worktree = path.join(root, 'main.worktrees', 'thing');
    await mkdir(main);
    await execa('git', ['init', '--quiet'], { cwd: main });
    await writeFile(path.join(main, '.gitignore'), 'logs/\n');
    await execa('git', ['add', '.gitignore'], { cwd: main });
    await execa('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], {
      cwd: main,
    });
    await execa('git', ['worktree', 'add', '--quiet', '-b', 'feat/thing', worktree], { cwd: main });
    configFile = path.join(root, 'fake', 'config.json');
    recordFile = path.join(root, 'fake', 'calls.jsonl');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  async function run(results, options = { request: 'Add a thing.' }) {
    await mkdir(path.dirname(configFile), { recursive: true });
    await writeFile(configFile, JSON.stringify({ recordFile, results }));
    return autoRun({
      command: [process.execPath, FAKE_CLAUDE, configFile],
      cwd: worktree,
      planRounds: 3,
      implementationRounds: 1,
      ...options,
    });
  }

  async function runDir() {
    const [dir] = await readdir(path.join(main, 'logs', 'auto'));
    return path.join(main, 'logs', 'auto', dir);
  }

  async function calls() {
    const text = await readFile(recordFile, 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  it('plans, then builds the saved plan, and is ready when nothing is left', async () => {
    const outcome = await run({
      plan: success(planReport),
      implementation: success(implementationReport),
    });

    expect(outcome).toEqual({
      ready: true,
      reasons: [],
      plan: planReport,
      implementation: implementationReport,
    });
    const [plan, implementation] = await calls();
    expect(plan.prompt).toContain('plan-orchestrator');
    expect(plan.prompt).toContain('<request>\nAdd a thing.\n</request>');
    expect(implementation.prompt).toContain(
      'implementation-orchestrator skill to build the plan at docs/plans/2026-10-08-thing.md',
    );
  });

  it('gives each session the auto settings', async () => {
    await run({ plan: success(planReport), implementation: success(implementationReport) });

    const [plan] = await calls();
    expect(plan.settings).toBe(
      'Workflow settings:\n' +
        '{"planCheckIn":"skip",' +
        '"planReview":{"findings":"fix_all","rounds":{"mode":"fixed","count":3}},' +
        '"implementationReview":{"findings":"fix_all","rounds":{"mode":"fixed","count":1}},' +
        '"decisions":"recommended"}\n',
    );
  });

  it('stops after planning when the plan leaves an action for the engineer', async () => {
    const outcome = await run({
      plan: success({ ...planReport, engineerActions: ['Add GITHUB_TOKEN to .env'] }),
      implementation: success(implementationReport),
    });

    expect(outcome.ready).toBe(false);
    expect(outcome.reasons).toEqual(['Engineer action: Add GITHUB_TOKEN to .env']);
    expect(outcome.implementation).toBeNull();
    expect(await calls()).toHaveLength(1);
  });

  it('stops after planning when the plan session stopped', async () => {
    const outcome = await run({
      plan: success({ ...planReport, outcome: 'stopped', stopReason: 'No such area' }),
      implementation: success(implementationReport),
    });

    expect(outcome.reasons).toEqual(['Stopped: No such area']);
    expect(outcome.implementation).toBeNull();
  });

  it('builds a given plan without planning', async () => {
    const outcome = await run(
      { plan: null, implementation: success(implementationReport) },
      { planPath: 'docs/plans/given.md' },
    );

    expect(outcome.ready).toBe(true);
    expect(outcome.plan).toBeNull();
    const [implementation] = await calls();
    expect(implementation.prompt).toContain('the plan at docs/plans/given.md');
  });

  it('is not ready when a check failed', async () => {
    const checks = { passed: [], failed: ['Vitest'], notRun: [] };
    const outcome = await run({
      plan: success(planReport),
      implementation: success({ ...implementationReport, checks }),
    });

    expect(outcome.ready).toBe(false);
    expect(outcome.reasons).toEqual(['Failed check: Vitest']);
  });

  it('keeps the logs in the main checkout, so removing the worktree keeps them', async () => {
    await run({ plan: success(planReport), implementation: success(implementationReport) });

    expect((await readdir(await runDir())).toSorted()).toEqual([
      'implementation.jsonl',
      'outcome.json',
      'plan.jsonl',
      'request.md',
      'run.json',
      'settings.md',
    ]);
  });

  it('tells each session how to start and stop long-running processes', async () => {
    await run({ plan: success(planReport), implementation: success(implementationReport) });

    for (const { prompt } of await calls()) {
      expect(prompt).toContain("only with the Bash tool's run_in_background");
    }
  });

  it('writes the outcome beside the logs', async () => {
    const outcome = await run({
      plan: success(planReport),
      implementation: success(implementationReport),
    });

    expect(JSON.parse(await readFile(path.join(await runDir(), OUTCOME_FILE), 'utf8'))).toEqual(
      outcome,
    );
  });

  it('writes the error as the outcome when a session fails', async () => {
    await expect(run({ plan: null, implementation: null })).rejects.toThrow(
      'The session ended with no result',
    );

    const outcome = JSON.parse(await readFile(path.join(await runDir(), OUTCOME_FILE), 'utf8'));
    expect(outcome.error).toMatch(/^The session ended with no result/);
  });

  describe('resuming a session', () => {
    const settings = 'Workflow settings:\n{"kept":true}\n';

    async function cutOff(phase) {
      const logDir = path.join(main, 'logs', 'auto', 'earlier');
      await mkdir(logDir, { recursive: true });
      await writeFile(path.join(logDir, 'settings.md'), settings);
      await writeFile(path.join(logDir, OUTCOME_FILE), '{"ready":false}');
      const init = { type: 'system', subtype: 'init', session_id: `${phase}-cut-off` };
      const logFile = path.join(logDir, `${phase}.jsonl`);
      await writeFile(logFile, `${JSON.stringify(init)}\n`);
      return logFile;
    }

    it('continues the cut-off session in a dirty worktree, with its settings', async () => {
      const resumeLog = await cutOff('implementation');
      await writeFile(path.join(worktree, 'partial.txt'), 'x');

      const outcome = await run(
        { plan: null, implementation: null, resume: success(implementationReport) },
        { resumeLog },
      );

      expect(outcome.ready).toBe(true);
      const [resumed] = await calls();
      expect(resumed.args.slice(0, 3)).toEqual(['-p', '--resume', 'implementation-cut-off']);
      expect(resumed.prompt).toContain('You were cut off before your workflow finished.');
      expect(resumed.settings).toBe(settings);
      expect(await calls()).toHaveLength(1);
    });

    it('builds the plan after a resumed plan session finishes', async () => {
      const resumeLog = await cutOff('plan');

      const outcome = await run(
        { plan: null, implementation: success(implementationReport), resume: success(planReport) },
        { resumeLog },
      );

      expect(outcome.ready).toBe(true);
      const [, implementation] = await calls();
      expect(implementation.prompt).toContain('the plan at docs/plans/2026-10-08-thing.md');
    });

    it('replaces the earlier outcome when the resumed run ends', async () => {
      const resumeLog = await cutOff('implementation');

      const outcome = await run(
        { plan: null, implementation: null, resume: success(implementationReport) },
        { resumeLog },
      );

      const written = await readFile(path.join(path.dirname(resumeLog), OUTCOME_FILE), 'utf8');
      expect(JSON.parse(written)).toEqual(outcome);
    });

    it('refuses a file that is not a session log', async () => {
      const resumeLog = path.join(path.dirname(await cutOff('plan')), 'settings.md');

      await expect(run({}, { resumeLog })).rejects.toThrow(
        `${resumeLog} is not a plan.jsonl or implementation.jsonl session log`,
      );
    });
  });

  it('refuses to start in the main checkout', async () => {
    await expect(
      run({ plan: null, implementation: null }, { request: 'x', cwd: main }),
    ).rejects.toThrow('Run auto-run from a linked worktree');
  });

  it('refuses to start on a detached HEAD', async () => {
    await execa('git', ['switch', '--quiet', '--detach'], { cwd: worktree });
    await expect(run({ plan: null, implementation: null })).rejects.toThrow(
      'The worktree has a detached HEAD',
    );
  });

  it('refuses to start with uncommitted changes', async () => {
    await writeFile(path.join(worktree, 'stray.txt'), 'x');
    await expect(run({ plan: null, implementation: null })).rejects.toThrow(
      'The working tree has uncommitted changes',
    );
    expect(await calls()).toEqual([]);
  });
});
