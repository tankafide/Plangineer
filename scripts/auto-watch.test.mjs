import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMilestone, sessionMilestone, startWatch } from './auto-watch.mjs';

const init = { type: 'system', subtype: 'init', session_id: 'abc' };
const planReport = {
  outcome: 'done',
  branch: 'feat/thing',
  commits: [],
  decisions: [],
  engineerActions: [],
  planPath: 'docs/plans/thing.md',
};
const ended = (report) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output: { report },
});
const line = (event) => `${JSON.stringify(event)}\n`;
const finding = {
  location: 'docs/plans/thing.md:3',
  claim: 'Step 2 has no done-when line.',
  suggestedChange: 'Add one.',
  sourceSkill: 'plan-format',
  kind: 'defect',
  severity: 'should fix',
};
const reviewReport = { outcome: 'done', findings: [finding, finding, finding], planAudit: null };
const planFixReport = {
  outcome: 'done',
  valid: 2,
  invalid: 1,
  fixed: 2,
  decisions: [],
  engineerActions: [],
};

describe('sessionMilestone', () => {
  it.each([
    ['a start', init, 'Session started: plan'],
    ['a finished session', ended(planReport), 'Session ended: plan: done'],
    [
      'a stopped session, with its reason',
      ended({ ...planReport, outcome: 'stopped', stopReason: 'Cut off' }),
      'Session ended: plan: stopped: Cut off',
    ],
    [
      'a failed session',
      { type: 'result', subtype: 'success', is_error: true, result: 'Not signed in' },
      'Session failed: plan: success: Not signed in',
    ],
    [
      'a report that does not match its schema',
      ended({ outcome: 'done' }),
      'Session failed: plan: its report does not match its schema',
    ],
  ])('names %s', (_, event, milestone) => {
    expect(sessionMilestone('plan', event)).toBe(milestone);
  });

  it.each([
    ['plan-review-1', ended(reviewReport), 'Session ended: plan-review-1: done: 3 findings'],
    [
      'implementation-review-2',
      ended({ outcome: 'stopped', stopReason: 'No diff' }),
      'Session ended: implementation-review-2: stopped: No diff',
    ],
    ['plan', ended(planFixReport), 'Session ended: plan: done: 2 valid, 1 invalid, 2 fixed'],
    [
      'implementation',
      ended({ ...planFixReport, checks: { passed: [], failed: [], notRun: [] } }),
      'Session ended: implementation: done: 2 valid, 1 invalid, 2 fixed',
    ],
    [
      'plan-review-1',
      ended(planReport),
      'Session failed: plan-review-1: its report does not match its schema',
    ],
  ])("names the end of %s's session from its report", (session, event, milestone) => {
    expect(sessionMilestone(session, event)).toBe(milestone);
  });

  it('skips every other event', () => {
    expect(sessionMilestone('plan', { type: 'assistant' })).toBeUndefined();
  });
});

describe('runMilestone', () => {
  it.each([
    [{ ready: true, reasons: [] }, 'Run finished: ready to land'],
    [
      { ready: false, reasons: ['a', 'b'] },
      'Run finished: not ready, 2 reasons to read in its output',
    ],
    [{ error: 'The session ended with no result' }, 'Run failed: The session ended with no result'],
  ])('names the end of %j', (outcome, milestone) => {
    expect(runMilestone(outcome)).toBe(milestone);
  });
});

describe('startWatch', () => {
  let root;
  let logDir;
  let logFile;

  const git = (...args) => execa('git', args, { cwd: root });
  const commit = (message) =>
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', message);
  const watch = () => startWatch({ cwd: root, logDir });

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-watch-')));
    logDir = path.join(root, 'logs');
    logFile = path.join(logDir, 'plan.jsonl');
    await mkdir(logDir);
    await git('init', '--quiet');
    await commit('Start');
    const { stdout: baseCommit } = await git('rev-parse', 'HEAD');
    await writeFile(
      path.join(logDir, 'run.json'),
      JSON.stringify({ baseCommit, planPath: null, stepHeads: {} }),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reports what happened since the run began, even when it starts late', async () => {
    await writeFile(logFile, line(init));
    await commit('Plan the thing');

    expect(await (await watch()).poll()).toEqual({
      lines: [expect.stringMatching(/^Commit: [0-9a-f]+ Plan the thing$/), 'Session started: plan'],
      ended: false,
    });
  });

  it('reports each milestone once, then the end of the run', async () => {
    const watcher = await watch();
    await writeFile(logFile, line(init));
    expect((await watcher.poll()).lines).toEqual(['Session started: plan']);

    await appendFile(logFile, line(ended(planReport)));
    await writeFile(path.join(logDir, 'outcome.json'), '{"ready":true,"reasons":[]}');
    expect(await watcher.poll()).toEqual({
      lines: ['Session ended: plan: done', 'Run finished: ready to land'],
      ended: true,
    });
  });

  it('carries on where an earlier watcher of the run stopped', async () => {
    await writeFile(logFile, line(init));
    await (await watch()).poll();
    await commit('Plan the thing');
    await appendFile(logFile, line(ended(planReport)));

    expect((await (await watch()).poll()).lines).toEqual([
      expect.stringMatching(/^Commit: [0-9a-f]+ Plan the thing$/),
      'Session ended: plan: done',
    ]);
  });

  it('reports the start and end of a review session and of the resumed author', async () => {
    const watcher = await watch();
    await writeFile(
      path.join(logDir, 'plan-review-1.jsonl'),
      line(init) + line(ended(reviewReport)),
    );
    await writeFile(logFile, line(init) + line(ended(planReport)));
    expect((await watcher.poll()).lines.toSorted()).toEqual([
      'Session ended: plan-review-1: done: 3 findings',
      'Session ended: plan: done',
      'Session started: plan',
      'Session started: plan-review-1',
    ]);

    await appendFile(logFile, line(init) + line(ended(planFixReport)));
    expect((await watcher.poll()).lines).toEqual([
      'Session started: plan',
      'Session ended: plan: done: 2 valid, 1 invalid, 2 fixed',
    ]);
  });

  it('waits for a line the session is still writing', async () => {
    const watcher = await watch();
    const event = JSON.stringify(init);

    await writeFile(logFile, event.slice(0, 10));
    expect(await watcher.poll()).toEqual({ lines: [], ended: false });
    await appendFile(logFile, `${event.slice(10)}\n`);
    expect((await watcher.poll()).lines).toEqual(['Session started: plan']);
  });
});
