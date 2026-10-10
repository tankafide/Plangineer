import { appendFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runMilestone, sessionMilestone, startWatch } from './auto-watch.mjs';

const init = { type: 'system', subtype: 'init', session_id: 'abc' };
const ended = (report) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  structured_output: { report },
});

describe('sessionMilestone', () => {
  it.each([
    ['a start', init, 'Session started: plan'],
    ['a finished session', ended({ outcome: 'done' }), 'Session ended: plan: done'],
    [
      'a stopped session, with its reason',
      ended({ outcome: 'stopped', stopReason: 'Cut off' }),
      'Session ended: plan: stopped: Cut off',
    ],
    [
      'a failed session',
      { type: 'result', subtype: 'success', is_error: true, result: 'Not signed in' },
      'Session failed: plan: success: Not signed in',
    ],
  ])('names %s', (_, event, milestone) => {
    expect(sessionMilestone('plan', event)).toBe(milestone);
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

  const git = (...args) => execa('git', args, { cwd: root });
  const commit = (message) =>
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-qm', message);

  beforeEach(async () => {
    root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'auto-watch-')));
    logDir = path.join(root, 'logs');
    await mkdir(logDir);
    await git('init', '--quiet');
    await commit('Start');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('reports each milestone after it starts, then the end of the run', async () => {
    const logFile = path.join(logDir, 'implementation.jsonl');
    const earlier = ended({ outcome: 'stopped', stopReason: 'Old' });
    await writeFile(logFile, `${JSON.stringify(earlier)}\n`);
    const watch = await startWatch({ cwd: root, logDir });

    await appendFile(logFile, `${JSON.stringify(init)}\n`);
    expect(await watch.poll()).toEqual({
      lines: ['Session started: implementation'],
      ended: false,
    });
    await commit('Build the thing');
    await appendFile(logFile, `${JSON.stringify(ended({ outcome: 'done' }))}\n`);
    await writeFile(path.join(logDir, 'outcome.json'), '{"ready":true,"reasons":[]}');
    expect(await watch.poll()).toEqual({
      lines: [
        expect.stringMatching(/^Commit: [0-9a-f]+ Build the thing$/),
        'Session ended: implementation: done',
        'Run finished: ready to land',
      ],
      ended: true,
    });
  });

  it('waits for a line the session is still writing', async () => {
    const logFile = path.join(logDir, 'plan.jsonl');
    const watch = await startWatch({ cwd: root, logDir });

    const event = JSON.stringify(init);
    await writeFile(logFile, event.slice(0, 10));
    expect(await watch.poll()).toEqual({ lines: [], ended: false });
    await appendFile(logFile, `${event.slice(10)}\n`);
    expect((await watch.poll()).lines).toEqual(['Session started: plan']);
  });
});
