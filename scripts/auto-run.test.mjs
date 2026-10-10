import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OUTCOME_FILE } from './auto-run-log.mjs';
import {
  answer,
  createRepos,
  implementationFixReport,
  PLAN_PATH,
  planFixReport,
  planReport,
  quietResults,
  reviewReport,
} from './auto-run-test-kit.mjs';

const fix = (report, file) => answer(report, { writes: { [file]: `${file}\n` }, commit: true });

/** Two plan rounds and one implementation round, each finding something valid. */
const fullResults = () =>
  quietResults({
    'plan-review': [
      answer(reviewReport(['First'])),
      answer(reviewReport(['Second', 'Third'], 'Plan audit')),
    ],
    'plan-fix': [
      fix(planFixReport({ valid: 1 }), 'docs/fix-1.md'),
      fix(planFixReport({ valid: 1, invalid: 1 }), 'docs/fix-2.md'),
    ],
    'implementation-review': [answer(reviewReport(['Fourth'], '| Step | Built |'))],
    'implementation-fix': [fix(implementationFixReport({ valid: 1 }), 'src/fix.ts')],
  });

/** Each run starts a dozen processes per session, which takes seconds on Windows. */
const RUN_TIMEOUT = { timeout: 60_000 };

describe('autoRun with two plan rounds and one implementation round', () => {
  let repos;
  let outcome;

  beforeAll(async () => {
    repos = await createRepos();
    outcome = await repos.run(fullResults(), { request: 'Add a thing.', planRounds: 2 });
  }, RUN_TIMEOUT.timeout);

  afterAll(async () => {
    await repos.remove();
  });

  it('runs each review round in its own session and resumes the author to fix it', () => {
    expect(outcome.ready).toBe(true);
    expect(outcome.reasons).toEqual([]);
    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan',
      'plan-review-1',
      'plan-fix-1',
      'plan-review-2',
      'plan-fix-2',
      'implementation',
      'implementation-review-1',
      'implementation-fix-1',
    ]);
    expect(outcome.sessions[4].report).toEqual(planFixReport({ valid: 1, invalid: 1 }));
  });

  it('resumes the author session with only the findings folder added', async () => {
    const runDir = await repos.runDir();
    const findingsDir = path.join(runDir, 'findings');
    const fixes = (await repos.calls()).filter(({ key }) => key.endsWith('-fix'));
    expect(fixes.map(({ args }) => args.slice(0, 5))).toEqual([
      ['-p', '--resume', 'plan-session', '--add-dir', findingsDir],
      ['-p', '--resume', 'plan-session', '--add-dir', findingsDir],
      ['-p', '--resume', 'implementation-session', '--add-dir', findingsDir],
    ]);
    expect(fixes[1].prompt).toContain(
      `Plan review round 2 wrote its findings to ${path.join(findingsDir, 'plan-review-2.findings.json')}.`,
    );
    expect((await readdir(findingsDir)).toSorted()).toEqual([
      'implementation-review-1.findings.json',
      'plan-review-1.findings.json',
      'plan-review-2.findings.json',
    ]);
  });

  it("writes each review's findings and plan audit with the review's target", async () => {
    const findingsDir = path.join(await repos.runDir(), 'findings');
    const read = async (name) => JSON.parse(await readFile(path.join(findingsDir, name), 'utf8'));
    expect(await read('plan-review-2.findings.json')).toEqual({
      review: 'plan',
      planPath: PLAN_PATH,
      baseCommit: null,
      headCommit: await repos.commitOf('plan-fix 1'),
      planAudit: 'Plan audit',
      findings: reviewReport(['Second', 'Third']).findings,
    });
    expect(await read('implementation-review-1.findings.json')).toEqual({
      review: 'implementation',
      planPath: PLAN_PATH,
      baseCommit: await repos.mergeBase(),
      headCommit: await repos.commitOf('implementation 1'),
      planAudit: '| Step | Built |',
      findings: reviewReport(['Fourth']).findings,
    });
  });

  it('gives each review its target', async () => {
    const calls = await repos.calls();
    const planReview = calls.find(({ key }) => key === 'plan-review');
    const implementationReview = calls.find(({ key }) => key === 'implementation-review');
    expect(planReview.prompt).toContain(`review the plan at ${PLAN_PATH}.`);
    expect(implementationReview.prompt).toContain(
      `review the diff from ${await repos.mergeBase()} to ${await repos.commitOf('implementation 1')} against the plan at ${PLAN_PATH}.`,
    );
  });

  it('logs each session under its step, and appends each fix to its author log', async () => {
    const runDir = await repos.runDir();
    expect((await readdir(runDir)).toSorted()).toEqual([
      'findings',
      'implementation-review-1.jsonl',
      'implementation.jsonl',
      'outcome.json',
      'plan-review-1.jsonl',
      'plan-review-2.jsonl',
      'plan.jsonl',
      'request.md',
      'run.json',
      'settings.md',
    ]);
    const planLog = await readFile(path.join(runDir, 'plan.jsonl'), 'utf8');
    expect(planLog.match(/"subtype":"init"/g)).toHaveLength(3);
  });

  it('records the plan path and each step’s starting commit in the run file', async () => {
    const run = JSON.parse(await readFile(path.join(await repos.runDir(), 'run.json'), 'utf8'));
    expect(run.planPath).toBe(PLAN_PATH);
    expect(run.stepHeads['plan-review-2']).toBe(await repos.commitOf('plan-fix 1'));
    expect(Object.keys(run.stepHeads)).toHaveLength(8);
  });

  it('answers each call with a key from the next entry of that key’s list', async () => {
    const reviews = (await repos.calls()).filter(({ key }) => key === 'plan-review');
    expect(reviews).toHaveLength(2);
    expect(outcome.sessions[3].report).toEqual(reviewReport(['Second', 'Third'], 'Plan audit'));
  });
});

describe('autoRun', RUN_TIMEOUT, () => {
  let repos;

  beforeEach(async () => {
    repos = await createRepos();
  });

  afterEach(async () => {
    await repos.remove();
  });

  it('stops a phase’s rounds after a fix that judged nothing valid', async () => {
    const outcome = await repos.run(
      quietResults({
        'plan-review': [answer(reviewReport(['Wrong']))],
        'plan-fix': [answer(planFixReport({ valid: 0, invalid: 1 }), { commit: true })],
      }),
      { request: 'Add a thing.', planRounds: 3 },
    );

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan',
      'plan-review-1',
      'plan-fix-1',
      'implementation',
      'implementation-review-1',
    ]);
  });

  it('stops a phase’s rounds after a review with no findings, resuming no author', async () => {
    const outcome = await repos.run(quietResults(), { request: 'Add a thing.', planRounds: 3 });

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan',
      'plan-review-1',
      'implementation',
      'implementation-review-1',
    ]);
    expect(await readdir(path.join(await repos.runDir(), 'findings'))).toEqual([]);
  });

  it('ends the run when a review stops', async () => {
    const outcome = await repos.run(
      quietResults({
        'plan-review': [answer({ outcome: 'stopped', stopReason: 'No plan found' })],
      }),
    );

    expect(outcome).toMatchObject({ ready: false, reasons: ['Stopped: No plan found'] });
    expect(outcome.sessions).toHaveLength(2);
  });

  it('reviews and fixes a plan with an engineer action, then ends before building', async () => {
    const outcome = await repos.run(
      quietResults({
        plan: [
          answer(planReport({ engineerActions: ['Add GITHUB_TOKEN to .env'] }), { commit: true }),
        ],
        'plan-review': [answer(reviewReport(['First']))],
        'plan-fix': [fix(planFixReport({ valid: 1 }), 'docs/fix.md')],
      }),
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.reasons).toEqual(['Engineer action: Add GITHUB_TOKEN to .env']);
    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan',
      'plan-review-1',
      'plan-fix-1',
    ]);
  });

  it('is not ready when the last implementation fix failed a check', async () => {
    const outcome = await repos.run(
      quietResults({
        'implementation-review': [answer(reviewReport(['First']))],
        'implementation-fix': [
          fix(implementationFixReport({ valid: 1, failed: ['Vitest'] }), 'src/fix.ts'),
        ],
      }),
    );

    expect(outcome.ready).toBe(false);
    expect(outcome.reasons).toEqual(['Failed check: Vitest']);
  });

  it('builds a given plan without planning or reviewing it', async () => {
    const outcome = await repos.run(quietResults({ plan: [] }), {
      planPath: 'docs/plans/given.md',
    });

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'implementation',
      'implementation-review-1',
    ]);
    const [implementation] = await repos.calls();
    expect(implementation.prompt).toContain('the plan at docs/plans/given.md');
  });

  it('gives each session the auto settings', async () => {
    await repos.run(quietResults(), { request: 'Add a thing.', planRounds: 3 });

    const [plan] = await repos.calls();
    expect(plan.settings).toBe(
      'Workflow settings:\n' +
        '{"planCheckIn":"skip",' +
        '"planReview":{"findings":"fix_all","rounds":{"mode":"fixed","count":3}},' +
        '"implementationReview":{"findings":"fix_all","rounds":{"mode":"fixed","count":1}},' +
        '"decisions":"recommended"}\n',
    );
  });

  it('writes the outcome beside the logs', async () => {
    const outcome = await repos.run(quietResults());

    const written = await readFile(path.join(await repos.runDir(), OUTCOME_FILE), 'utf8');
    expect(JSON.parse(written)).toEqual(outcome);
  });

  it('writes the error as the outcome when a session fails', async () => {
    await expect(repos.run(quietResults({ plan: [answer(null)] }))).rejects.toThrow(
      'The session ended with no result',
    );

    const written = await readFile(path.join(await repos.runDir(), OUTCOME_FILE), 'utf8');
    expect(JSON.parse(written).error).toMatch(/^The session ended with no result/);
  });
});
