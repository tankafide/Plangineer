import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { autoRun, parseCli, settingsBlock } from './auto-run.mjs';
import { repoRoot } from './script-entry.mjs';

const FAKE_CLAUDE = path.join(repoRoot, 'scripts/auto-run-fake-claude.mjs');

const planReport = {
  outcome: 'done',
  stopReason: null,
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
  pullRequest: { title: 'Build the thing', body: 'Builds the thing.' },
};
delete implementationReport.planPath;

const success = (structured_output) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output,
});

describe('autoRun', () => {
  let root;
  let configFile;
  let recordFile;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'auto-run-'));
    await execa('git', ['init', '--quiet'], { cwd: root });
    await writeFile(path.join(root, '.gitignore'), 'logs/\nfake/\n');
    await execa('git', ['add', '.gitignore'], { cwd: root });
    await execa('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init'], {
      cwd: root,
    });
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
      cwd: root,
      planRounds: 3,
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

  it('starts each session headless, unattended, with the settings and the report schema', async () => {
    await run({ plan: success(planReport), implementation: success(implementationReport) });

    const [plan] = await calls();
    expect(plan.args.slice(0, 8)).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'auto',
      '--permission-prompts',
      'none',
    ]);
    expect(plan.settings).toBe(settingsBlock({ planRounds: 3, implementationRounds: 1 }));
    const schema = JSON.parse(plan.args[plan.args.indexOf('--json-schema') + 1]);
    expect(schema.required).toContain('engineerActions');
    expect(schema.required).toContain('planPath');
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

  it('fails a finished plan session that saved no plan', async () => {
    await expect(
      run({ plan: success({ ...planReport, planPath: null }), implementation: null }),
    ).rejects.toThrow('The plan session finished without a plan path');
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

  it('fails a session that ends with no result', async () => {
    await expect(run({ plan: null, implementation: null })).rejects.toThrow(/with no result/);
  });

  it('fails a session that ends in an error', async () => {
    const error = { type: 'result', subtype: 'error_max_turns', is_error: true };
    await expect(run({ plan: error, implementation: null })).rejects.toThrow(/error_max_turns/);
  });

  it('fails a report that does not match the schema', async () => {
    const { engineerActions: _, ...missing } = planReport;
    await expect(run({ plan: success(missing), implementation: null })).rejects.toThrow(
      /engineerActions/,
    );
  });

  it('refuses to start with uncommitted changes', async () => {
    await writeFile(path.join(root, 'stray.txt'), 'x');
    await expect(run({ plan: null, implementation: null })).rejects.toThrow(
      'The working tree has uncommitted changes',
    );
    expect(await calls()).toEqual([]);
  });
});

describe('parseCli', () => {
  it('defaults both review loops to two rounds', () => {
    expect(parseCli(['--request-file', 'r.md'])).toEqual({
      requestFile: 'r.md',
      planPath: undefined,
      planRounds: 2,
      implementationRounds: 2,
    });
  });

  it('takes the round counts', () => {
    const options = parseCli([
      '--plan',
      'p.md',
      '--plan-rounds',
      '4',
      '--implementation-rounds',
      '1',
    ]);
    expect(options).toMatchObject({ planPath: 'p.md', planRounds: 4, implementationRounds: 1 });
  });

  it.each([[[]], [['--request-file', 'r.md', '--plan', 'p.md']]])(
    'requires exactly one of a request and a plan: %j',
    (argv) => {
      expect(() => parseCli(argv)).toThrow('Pass exactly one of --request-file and --plan');
    },
  );

  it('rejects a round count under one', () => {
    expect(() => parseCli(['--plan', 'p.md', '--plan-rounds', '0'])).toThrow(
      'expected number to be >=1',
    );
  });
});
