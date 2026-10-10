import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  answer,
  createRepos,
  PLAN_PATH,
  planFixReport,
  planReport,
  quietResults,
  reviewReport,
} from './auto-run-test-kit.mjs';

const CUT_OFF = 'The session ended with no result';

/** Each run starts a dozen processes per session, which takes seconds on Windows. */
describe('autoRun resuming a cut-off session', { timeout: 60_000 }, () => {
  let repos;

  beforeEach(async () => {
    repos = await createRepos();
  });

  afterEach(async () => {
    await repos.remove();
  });

  /** Runs until a session ends with no result, then resumes the log named. */
  async function cutOffThenResume(results, log, options = { request: 'Add a thing.' }) {
    await expect(repos.run(results, options)).rejects.toThrow(CUT_OFF);
    const resumeLog = path.join(await repos.runDir(), log);
    const before = (await repos.calls()).length;
    const outcome = await repos.run(results, { resumeLog });
    return { outcome, resumed: (await repos.calls()).slice(before), resumeLog };
  }

  it('continues a cut-off review, then the rounds left in the settings and the build', async () => {
    const results = quietResults({
      'plan-review': [answer(null), answer(reviewReport([]))],
      resume: [answer(reviewReport(['First']))],
      'plan-fix': [answer(planFixReport({ valid: 1 }), { commit: true })],
    });

    const { outcome, resumed } = await cutOffThenResume(results, 'plan-review-1.jsonl', {
      request: 'Add a thing.',
      planRounds: 2,
    });

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan-review-1',
      'plan-fix-1',
      'plan-review-2',
      'implementation',
      'implementation-review-1',
    ]);
    expect(resumed[0].args.slice(0, 3)).toEqual(['-p', '--resume', 'plan-review-session']);
    expect(resumed[0].prompt).toContain('You were cut off before your workflow finished.');
    expect(resumed[1].prompt).toContain(
      `wrote its findings to ${path.join(await repos.runDir(), 'findings', 'plan-review-1.findings.json')}.`,
    );
  });

  it('continues an author log as the fix of the last round with a findings file', async () => {
    const results = quietResults({
      'plan-review': [answer(reviewReport(['First']))],
      'plan-fix': [answer(null)],
      resume: [answer(planFixReport({ valid: 1 }), { commit: true })],
    });

    const { outcome, resumed } = await cutOffThenResume(results, 'plan.jsonl');

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan-fix-1',
      'implementation',
      'implementation-review-1',
    ]);
    const findingsDir = path.join(await repos.runDir(), 'findings');
    expect(resumed[0].args.slice(0, 5)).toEqual([
      '-p',
      '--resume',
      'plan-session',
      '--add-dir',
      findingsDir,
    ]);
    expect(resumed[1].prompt).toContain(`build the plan at ${PLAN_PATH}`);
  });

  it('continues an author log with no findings file as its authoring session', async () => {
    const results = quietResults({
      plan: [answer(null, { writes: { [PLAN_PATH]: '# Thing\n' } })],
      resume: [answer(planReport(), { commit: true })],
    });

    const { outcome, resumed } = await cutOffThenResume(results, 'plan.jsonl');

    expect(outcome.sessions.map(({ step }) => step)).toEqual([
      'plan',
      'plan-review-1',
      'implementation',
      'implementation-review-1',
    ]);
    expect(resumed[0].args.slice(0, 4)).toEqual([
      '-p',
      '--resume',
      'plan-session',
      '--output-format',
    ]);
  });

  it('checks a resumed plan fix against the commit its step first started from', async () => {
    const results = quietResults({
      'plan-review': [answer(reviewReport(['First']))],
      'plan-fix': [answer(null, { writes: { 'src/early.ts': 'x' }, commit: true })],
      resume: [answer(planFixReport({ valid: 1 }), { commit: true })],
    });

    await expect(cutOffThenResume(results, 'plan.jsonl')).rejects.toThrow(
      'The plan-fix-1 session changed files outside docs/: src/early.ts',
    );
  });

  it('replaces the earlier outcome when the resumed run ends', async () => {
    const results = quietResults({
      'plan-review': [answer(null)],
      resume: [answer(reviewReport([]))],
    });

    const { outcome, resumeLog } = await cutOffThenResume(results, 'plan-review-1.jsonl');

    const written = await readFile(path.join(path.dirname(resumeLog), 'outcome.json'), 'utf8');
    expect(JSON.parse(written)).toEqual(outcome);
  });

  it('refuses a file that is not a session log', async () => {
    await expect(repos.run(quietResults({ plan: [answer(null)] }))).rejects.toThrow(CUT_OFF);
    const resumeLog = path.join(await repos.runDir(), 'settings.md');

    await expect(repos.run({}, { resumeLog })).rejects.toThrow(
      `${resumeLog} is not a session log of an auto run`,
    );
  });
});
