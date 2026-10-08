import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isTerminalRunEvent, RunnerSocketClose } from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRunnerEnv, type RunnerEnv } from './config/runner-env.ts';
import { type Runner, startCommand } from './start-command.ts';
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

const REVOKED =
  'This runner was revoked or its token is invalid. Pair it again with pnpm runner pair.';

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

async function start(): Promise<Runner> {
  runner = await startTestRunner(env, plane);
  await plane.waitFor(isMessage('hello'));
  return runner;
}

const helloOn = (connection: number) =>
  plane.waitFor(
    (message): message is Extract<typeof message, { type: 'hello' }> =>
      message.type === 'hello' &&
      plane.received.some((entry) => entry.message === message && entry.connection === connection),
  );

const eventsOn = (runId: string, connection: number) =>
  plane.received.flatMap(({ message, connection: carriedBy }) =>
    message.type === 'run.events' && message.runId === runId && carriedBy === connection
      ? message.events
      : [],
  );

/** Runs the start command until the fake control plane closes its socket with `code`. */
async function startAndClose(code: number) {
  const exited = startCommand(env);
  await plane.waitFor(isMessage('hello'));
  plane.closeSocket(code, 'closed by the test');
  return exited;
}

describe('the control plane socket', () => {
  it('says hello with the platform, concurrency, CLI status and no active runs', async () => {
    await start();

    expect(await plane.waitFor(isMessage('hello'))).toEqual({
      type: 'hello',
      runnerVersion: '0.0.0',
      platform: process.platform,
      concurrencyLimit: 2,
      clis: [
        { name: 'claude-code', version: '2.1.284', available: true, minimumVersion: '2.1.284' },
      ],
      activeRuns: [],
    });
  });

  it('reconnects after a drop and resends only the events above the acknowledged sequence', async () => {
    await start();
    const runId = plane.assign(testJob('fake:slow'));
    await vi.waitFor(() => expect(plane.events(runId).length).toBeGreaterThanOrEqual(3), {
      timeout: 10_000,
    });
    plane.autoAck = false;
    const ackedSeq = Math.max(...plane.events(runId).map((entry) => entry.seq));
    await vi.waitFor(() => expect(plane.events(runId).at(-1)?.seq).toBeGreaterThan(ackedSeq), {
      timeout: 10_000,
    });

    plane.autoAck = true;
    plane.dropSocket();
    const hello = await helloOn(2);
    await plane.waitForEvent(runId, 'run.succeeded');

    expect(hello.activeRuns).toEqual([{ runId, attempt: 1 }]);
    const resent = eventsOn(runId, 2);
    expect(resent[0]?.seq).toBe(ackedSeq + 1);
    const seqs = new Set(plane.events(runId).map((entry) => entry.seq));
    expect([...seqs].toSorted((a, b) => a - b)).toEqual([...seqs].map((_, index) => index + 1));
  });

  it('stops a job the welcome marks invalid after a reconnect and resends nothing for it', async () => {
    await start();
    const runId = plane.assign(testJob('fake:hang'));
    const pids = await waitForFakePids(plane, runId);
    plane.welcomeRun = () => ({ valid: false });

    plane.dropSocket();
    await helloOn(2);

    await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
    runner?.shutdown();
    await runner?.exited;
    expect(eventsOn(runId, 2)).toEqual([]);
    expect(plane.events(runId).some((entry) => isTerminalRunEvent(entry.event))).toBe(false);
  });

  it('stops a job with no terminal event when a heartbeat reply says it is invalid', async () => {
    plane.heartbeatIntervalMs = 200;
    await start();
    const runId = plane.assign(testJob('fake:hang'));
    const pids = await waitForFakePids(plane, runId);

    plane.heartbeatReply = () => ({ valid: false, cancelRequested: false });

    await vi.waitFor(() => expect(pids.map(isProcessRunning)).toEqual([false, false]));
    runner?.shutdown();
    await runner?.exited;
    expect(plane.events(runId).some((entry) => isTerminalRunEvent(entry.event))).toBe(false);
  });

  it('reconnects after a close that reconnecting can fix', async () => {
    await start();

    plane.closeSocket(RunnerSocketClose.goingAway);

    await helloOn(2);
    expect(plane.connections).toBe(2);
  });
});

describe('startCommand', () => {
  it('exits 1 with the revoked message on a 4001 close', async () => {
    expect(await startAndClose(RunnerSocketClose.revoked)).toEqual({ ok: false, message: REVOKED });
  });

  it('exits 1 with the revoked message when the handshake gets 401', async () => {
    plane.token = 'another-token';

    expect(await startCommand(env)).toEqual({ ok: false, message: REVOKED });
  });

  it('exits 1 with the takeover message on a 4002 close', async () => {
    expect(await startAndClose(RunnerSocketClose.replaced)).toEqual({
      ok: false,
      message:
        'Another runner process using this pairing took over. Stop that process, or pair this machine as a second runner.',
    });
  });

  it.each([RunnerSocketClose.policyViolation, RunnerSocketClose.messageTooBig])(
    'exits 1 without reconnecting on a %i close',
    async (code) => {
      const result = await startAndClose(code);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('protocol');
      expect(plane.connections).toBe(1);
    },
  );

  it('exits 1 with a message when the runner is not paired', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-unpaired-'));
    const parsed = parseRunnerEnv({ PLANGINEER_RUNNER_DATA_DIR: dataDir });
    if (!parsed.ok) throw new Error(parsed.message);

    expect(await startCommand(parsed.env)).toEqual({
      ok: false,
      message: 'This runner is not paired. Run pnpm runner pair first.',
    });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  });
});
