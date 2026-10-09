import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { type CliStatus, isTerminalRunEvent, RunnerSocketClose } from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { packageVersion } from './package-version.ts';
import { parseRunnerEnv, type RunnerEnv } from './config/runner-env.ts';
import { type Runner, startCommand } from './start-command.ts';
import { isProcessRunning } from './test/fake-agent.ts';
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
  waitForFakePids,
} from './test/test-runner.ts';

/** How often the runner detects Claude Code again while it runs. */
const DETECT_INTERVAL_MS = 30_000;
const REVOKED =
  'This runner was revoked or its token is invalid. Pair it again with plangineer-runner login.';

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
async function startAndClose(code: number, serverUrl: string | null = null) {
  const exited = startCommand(env, { serverUrl });
  await plane.waitFor(isMessage('hello'));
  plane.closeSocket(code, 'closed by the test');
  return exited;
}

describe('the control plane socket', () => {
  it('says hello with the platform, concurrency, CLI status and no active runs', async () => {
    await start();

    expect(await plane.waitFor(isMessage('hello'))).toEqual({
      type: 'hello',
      runnerVersion: packageVersion(),
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

const cliStatus = (available: boolean): CliStatus => ({
  name: 'claude-code',
  version: available ? '2.1.284' : null,
  available,
  minimumVersion: '2.1.284',
});

const reportedClis = () =>
  plane.received.flatMap(({ message }) => (message.type === 'runner.clis' ? [message.clis] : []));

describe('Claude Code status', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends runner.clis within one interval of a change, and nothing while it is unchanged', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let current = cliStatus(false);
    runner = await startTestRunner(env, plane, {
      ...scriptedAdapter([]),
      detect: () => Promise.resolve(current),
    });
    const hello = await plane.waitFor(isMessage('hello'));

    await vi.advanceTimersByTimeAsync(DETECT_INTERVAL_MS);
    current = cliStatus(true);
    await vi.advanceTimersByTimeAsync(DETECT_INTERVAL_MS);
    await plane.waitFor(isMessage('runner.clis'));
    await vi.advanceTimersByTimeAsync(DETECT_INTERVAL_MS);
    current = cliStatus(false);
    await vi.advanceTimersByTimeAsync(DETECT_INTERVAL_MS);
    await vi.waitUntil(() => reportedClis().length === 2);

    expect(hello.clis).toEqual([cliStatus(false)]);
    expect(reportedClis()).toEqual([[cliStatus(true)], [cliStatus(false)]]);
  });
});

describe('startCommand', () => {
  it('exits 3 with the revoked message on a 4001 close', async () => {
    expect(await startAndClose(RunnerSocketClose.revoked)).toEqual({
      exitCode: 3,
      message: REVOKED,
    });
  });

  it('exits 3 with the revoked message when the handshake gets 401', async () => {
    plane.token = 'another-token';

    expect(await startCommand(env, { serverUrl: null })).toEqual({
      exitCode: 3,
      message: REVOKED,
    });
  });

  it('exits 1 with the takeover message on a 4002 close', async () => {
    expect(await startAndClose(RunnerSocketClose.replaced)).toEqual({
      exitCode: 1,
      message:
        'Another runner process using this pairing took over. Stop that process, or pair this machine as a second runner.',
    });
  });

  it.each([RunnerSocketClose.policyViolation, RunnerSocketClose.messageTooBig])(
    'exits 1 without reconnecting on a %i close',
    async (code) => {
      const result = await startAndClose(code);

      expect(result.exitCode).toBe(1);
      expect(result.message).toContain('protocol');
      expect(plane.connections).toBe(1);
    },
  );

  it('exits 3 with a message when the runner is not paired', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-unpaired-'));
    const parsed = parseRunnerEnv({ PLANGINEER_RUNNER_DATA_DIR: dataDir });
    if (!parsed.ok) throw new Error(parsed.message);

    expect(await startCommand(parsed.env, { serverUrl: null })).toEqual({
      exitCode: 3,
      message: 'This runner is not paired. Run plangineer-runner login --server <url> first.',
    });
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
  });

  it('exits 3 without connecting when --server names another server', async () => {
    const other = 'http://127.0.0.1:1';

    expect(await startCommand(env, { serverUrl: other })).toEqual({
      exitCode: 3,
      message: `This runner is paired with ${plane.serverUrl}, not ${other}. Pair it again with plangineer-runner login --server ${other}.`,
    });
    expect(plane.connections).toBe(0);
  });

  it('connects when --server names the paired server', async () => {
    await startAndClose(RunnerSocketClose.revoked, `${plane.serverUrl}/`);

    expect(plane.connections).toBe(1);
  });
});
