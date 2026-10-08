import { stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_EVENTS_MESSAGE_BYTES, MAX_EVENTS_PER_MESSAGE } from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerEnv } from './config/runner-env.ts';
import type { Runner } from './start-command.ts';
import { isProcessRunning } from './test/fake-agent.ts';
import { type FakeControlPlane, startFakeControlPlane } from './test/fake-control-plane.ts';
import { createGitRemote, type GitRemote, SYNCED_SKILLS } from './test/git-remote.ts';
import {
  isMessage,
  removeDataDir,
  startTestRunner,
  TEST_REPOSITORY,
  testJob,
  testRunnerEnv,
  waitForFakePids,
} from './test/test-runner.ts';

let remote: GitRemote;
let commit: string;
let plane: FakeControlPlane;
let env: RunnerEnv;
let runner: Runner | undefined;

beforeAll(async () => {
  remote = await createGitRemote(TEST_REPOSITORY);
  commit = await remote.commit({ ...SYNCED_SKILLS, 'README.md': 'app\n' });
  await remote.commit({ '.claude/skills/stray/SKILL.md': 'stray\n' }, 'drifted');
});

afterAll(() => remote.cleanup());

async function start(variables: Record<string, string> = {}): Promise<Runner> {
  env = await testRunnerEnv({ plane, gitBaseUrl: remote.baseUrl, variables });
  runner = await startTestRunner(env, plane);
  await plane.waitFor(isMessage('hello'));
  return runner;
}

const eventTypes = (runId: string) => plane.events(runId).map((entry) => entry.event.type);

beforeEach(async () => {
  plane = await startFakeControlPlane();
});

afterEach(async () => {
  runner?.shutdown();
  await runner?.exited;
  runner = undefined;
  await plane.stop();
  await removeDataDir(env);
});

describe('startRunner', () => {
  it('streams an assigned run to run.succeeded in sequence and removes its worktree', async () => {
    const active = await start();

    const runId = plane.assign(testJob('fake:success'));
    await plane.waitForEvent(runId, 'run.succeeded');
    active.shutdown();
    await active.exited;

    const events = plane.events(runId);
    expect(events.map((entry) => entry.seq)).toEqual(events.map((_, index) => index + 1));
    expect(eventTypes(runId)).toEqual([
      'run.started',
      'agent.session',
      'agent.other',
      'agent.other',
      'agent.other',
      'agent.tool_use',
      'agent.rate_limit',
      'agent.other',
      'agent.tool_result',
      'agent.message',
      'agent.rate_limit',
      'agent.other',
      'agent.other',
      'run.succeeded',
    ]);
    expect(events[0]?.event).toEqual({
      type: 'run.started',
      commit,
      cli: { name: 'claude-code', version: '2.1.284' },
    });
    const worktreeFolder = path.join(env.PLANGINEER_RUNNER_DATA_DIR, 'w', `${runId}-1`);
    await expect(stat(worktreeFolder)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const { message, bytes } of plane.received) {
      if (message.type !== 'run.events') continue;
      expect(message.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_MESSAGE);
      expect(bytes).toBeLessThanOrEqual(MAX_EVENTS_MESSAGE_BYTES);
    }
  });

  it('starts a second run only after the first ends at a concurrency of 1', async () => {
    await start({ PLANGINEER_RUNNER_CONCURRENCY: '1' });

    const first = plane.assign(testJob('fake:success'));
    const second = plane.assign(testJob('fake:success'));
    await plane.waitForEvent(second, 'run.succeeded');

    const indexOf = (runId: string, type: string) =>
      plane.received.findIndex(
        ({ message }) =>
          message.type === 'run.events' &&
          message.runId === runId &&
          message.events.some((entry) => entry.event.type === type),
      );
    expect(indexOf(second, 'run.started')).toBeGreaterThan(indexOf(first, 'run.succeeded'));
  });

  it('ends a cancelled run with run.cancelled and stops the fake agent', async () => {
    await start();
    const runId = plane.assign(testJob('fake:hang'));
    const pids = await waitForFakePids(plane, runId);

    plane.cancel(runId);
    await plane.waitForEvent(runId, 'run.cancelled');

    expect(plane.events(runId).at(-1)?.event).toEqual({
      type: 'run.cancelled',
      reason: 'requested',
    });
    await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
  });

  it('cancels a run when a heartbeat reply reports a cancel request', async () => {
    plane.heartbeatIntervalMs = 200;
    await start();
    const runId = plane.assign(testJob('fake:hang'));
    await waitForFakePids(plane, runId);

    plane.heartbeatReply = () => ({ valid: true, cancelRequested: true });
    await plane.waitForEvent(runId, 'run.cancelled');

    expect(eventTypes(runId).filter((type) => type.startsWith('run.'))).toEqual([
      'run.started',
      'run.cancelled',
    ]);
  });

  it('fails a run with a drifted skills mirror with reason skills_drift before the agent starts', async () => {
    await start();

    const runId = plane.assign({ ...testJob('fake:success'), ref: 'drifted' });
    await plane.waitForEvent(runId, 'run.failed');

    expect(plane.events(runId).map((entry) => entry.event)).toEqual([
      {
        type: 'run.failed',
        reason: 'skills_drift',
        message: [
          'stray: .claude/skills/stray/SKILL.md',
          'Fix: Edit the file under .agents/skills/, then run pnpm skills:sync.',
        ].join('\n'),
        exitCode: null,
        stderrTail: [],
      },
    ]);
  });

  it('fails a run on an unknown ref with reason checkout_failed', async () => {
    await start();

    const runId = plane.assign({ ...testJob('fake:success'), ref: 'no-such-branch' });
    await plane.waitForEvent(runId, 'run.failed');

    expect(plane.events(runId).at(-1)?.event).toMatchObject({ reason: 'checkout_failed' });
  });

  it('fails a run that passes its time limit with reason timeout and stops the agent', async () => {
    await start({ PLANGINEER_RUN_TIMEOUT_MS: '2000' });
    const runId = plane.assign(testJob('fake:hang'));
    const pids = await waitForFakePids(plane, runId);

    await plane.waitForEvent(runId, 'run.failed');

    expect(plane.events(runId).at(-1)?.event).toMatchObject({ reason: 'timeout' });
    await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
  });

  it('fails running jobs with reason runner_stopped on shutdown and leaves no agent running', async () => {
    const active = await start();
    const runId = plane.assign(testJob('fake:hang'));
    const pids = await waitForFakePids(plane, runId);

    active.shutdown();

    expect(await active.exited).toEqual({ ok: true, message: 'Runner stopped.' });
    expect(plane.events(runId).at(-1)?.event).toMatchObject({
      type: 'run.failed',
      reason: 'runner_stopped',
    });
    await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
  });

  it('pauses the queue on a plan limit and reports the reset time', async () => {
    const active = await start({ PLANGINEER_RUNNER_CONCURRENCY: '1' });
    const limited = plane.assign(testJob('fake:rate-limit'));
    const waiting = plane.assign(testJob('fake:success'));

    await plane.waitForEvent(limited, 'run.failed');
    const status = await plane.waitFor(isMessage('runner.status'));
    active.shutdown();
    await active.exited;

    expect(plane.events(limited).at(-1)?.event).toMatchObject({ reason: 'plan_limit' });
    expect(status.planLimitResetsAt).toBe('2100-01-01T00:00:00.000Z');
    expect(eventTypes(waiting)).toEqual(['run.failed']);
    expect(plane.events(waiting)[0]?.event).toMatchObject({ reason: 'runner_stopped' });
  });
});
