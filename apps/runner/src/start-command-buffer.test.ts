import {
  isTerminalRunEvent,
  MAX_EVENTS_MESSAGE_BYTES,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RunnerEnv } from './config/runner-env.ts';
import { MAX_UNACKED_EVENTS } from './jobs/event-buffer.ts';
import type { Runner } from './start-command.ts';
import { type FakeControlPlane, startFakeControlPlane } from './test/fake-control-plane.ts';
import { createGitRemote, type GitRemote, SYNCED_SKILLS } from './test/git-remote.ts';
import {
  isMessage,
  removeDataDir,
  scriptedAdapter,
  startTestRunner,
  TEST_REPOSITORY,
  testJob,
  testRunnerEnv,
} from './test/test-runner.ts';

let remote: GitRemote;
let plane: FakeControlPlane;
let env: RunnerEnv;
let runner: Runner | undefined;

beforeAll(async () => {
  remote = await createGitRemote(TEST_REPOSITORY);
  await remote.commit(SYNCED_SKILLS);
});

afterAll(() => remote.cleanup());

beforeEach(async () => {
  plane = await startFakeControlPlane();
  env = await testRunnerEnv({ plane, gitBaseUrl: remote.baseUrl });
});

afterEach(async () => {
  runner?.shutdown();
  await runner?.exited;
  runner = undefined;
  await plane.stop();
  await removeDataDir(env);
});

async function start(events: RunnerRunEventBody[]): Promise<void> {
  runner = await startTestRunner(env, plane, scriptedAdapter(events));
  await plane.waitFor(isMessage('hello'));
}

function toolResults(count: number, length: number): RunnerRunEventBody[] {
  return Array.from({ length: count }, (_, index) => ({
    type: 'agent.tool_result',
    toolUseId: `toolu_${index}`,
    isError: false,
    text: 'x'.repeat(length),
    truncated: false,
  }));
}

describe('the event buffer in a run', () => {
  it('ends a run whose unacknowledged events fill the buffer with reason event_buffer_full', async () => {
    await start(toolResults(MAX_UNACKED_EVENTS + 50, 1));
    plane.autoAck = false;

    const runId = plane.assign(testJob('scripted'));
    await plane.waitForEvent(runId, 'run.failed');
    plane.acknowledgeAll(runId);

    const events = plane.events(runId);
    const terminal = events.filter((entry) => isTerminalRunEvent(entry.event));
    expect(terminal).toEqual([
      {
        seq: MAX_UNACKED_EVENTS + 1,
        event: expect.objectContaining({ type: 'run.failed', reason: 'event_buffer_full' }),
      },
    ]);
    expect(events).toHaveLength(MAX_UNACKED_EVENTS + 1);
  });

  it('sends thirty 60,000-character tool results in several batches under 512 KiB', async () => {
    await start(toolResults(30, 60_000));

    const runId = plane.assign(testJob('scripted'));
    await plane.waitForEvent(runId, 'run.succeeded');

    const batches = plane.received.filter(
      ({ message }) => message.type === 'run.events' && message.runId === runId,
    );
    expect(batches.length).toBeGreaterThan(3);
    for (const { bytes } of batches) expect(bytes).toBeLessThanOrEqual(MAX_EVENTS_MESSAGE_BYTES);
    expect(plane.events(runId)).toHaveLength(32);
    expect(plane.ackedSeq(runId)).toBe(32);
  });
});
