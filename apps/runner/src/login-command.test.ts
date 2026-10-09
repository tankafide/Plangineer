import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNNER_LOGIN_MESSAGE_MAX, RunnerLoginEvent } from '@plangineer/contracts';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRunnerEnv } from './config/runner-env.ts';
import { loginCommand } from './login-command.ts';
import {
  DEVICE_SECRET,
  EXPIRES_AT,
  type FakeLoginApi,
  internalError,
  startFakeLoginApi,
  tooManyRequests,
  USER_CODE,
} from './test/fake-login-api.ts';

const cliPath = fileURLToPath(new URL('cli.ts', import.meta.url));
const runnerId = randomUUID();

let api: FakeLoginApi;
let dataDir: string;

function cliLogin(flag: '--no-browser' | '--json') {
  return execa(
    process.execPath,
    [cliPath, 'login', '--server', api.serverUrl, '--name', 'test-runner', flag],
    { reject: false, env: { PLANGINEER_RUNNER_DATA_DIR: dataDir } },
  );
}

const login = () => cliLogin('--no-browser');
/** `login --json`, which implies --no-browser. */
const loginJson = () => cliLogin('--json');

const events = (stdout: string) =>
  stdout.split(/\r?\n/).map((line) => RunnerLoginEvent.parse(JSON.parse(line)));

const storedCredentials = async (): Promise<unknown> =>
  JSON.parse(await readFile(path.join(dataDir, 'runner.json'), 'utf8'));

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-login-'));
  api = await startFakeLoginApi();
});

afterEach(async () => {
  await api.close();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('login', () => {
  it('prints the link and user code, polls to approved, and stores the token in runner.json', async () => {
    api.pollReplies = [
      { json: { status: 'pending' } },
      { json: { status: 'approved', runnerId, token: 'issued-token' } },
    ];

    const result = await login();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      `To pair this machine, approve it in Plangineer: ${api.approveUrl}`,
      `Code: ${USER_CODE}`,
      'Paired as test-runner. Start the runner with plangineer-runner start.',
    ]);
    expect(api.requests.map((request) => request.path)).toEqual([
      '/rpc/runner/startLogin',
      '/rpc/runner/pollLogin',
      '/rpc/runner/pollLogin',
    ]);
    expect(api.requests[0]).toMatchObject({
      headers: expect.objectContaining({ 'x-csrf-token': 'orpc' }),
      body: { json: { name: 'test-runner', platform: process.platform } },
    });
    expect(api.requests[1]?.body).toEqual({ json: { deviceSecret: DEVICE_SECRET } });
    expect(await storedCredentials()).toEqual({
      serverUrl: api.serverUrl,
      runnerId,
      token: 'issued-token',
    });
  });

  it.each([
    ['denied', [{ json: { status: 'denied' } }], 'The pairing was denied in Plangineer.'],
    [
      'expired',
      [{ json: { status: 'pending' } }, { json: { status: 'expired' } }],
      'The pairing request expired. Run plangineer-runner login again.',
    ],
  ])(
    'exits 1 with a message and writes nothing for a %s request',
    async (_name, replies, message) => {
      api.pollReplies = replies;

      const result = await login();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(message);
      expect(await readdir(dataDir)).toEqual([]);
    },
  );

  it('exits 1 with a message and polls nothing when the API has too many pending requests', async () => {
    api.startReply = tooManyRequests;

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'Too many pairing requests are waiting in Plangineer. Try again in a few minutes.',
    );
    expect(api.requests).toHaveLength(1);
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('exits 1 with the error message when the API cannot be reached', async () => {
    await api.close();

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe('');
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('exits 1 with the error message when a poll fails', async () => {
    api.pollReplies = [internalError('Boom')];

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Boom');
    expect(await readdir(dataDir)).toEqual([]);
  });
});

describe('login --json', () => {
  it('prints login_started then paired as JSON lines, stores runner.json and exits 0', async () => {
    api.pollReplies = [{ json: { status: 'approved', runnerId, token: 'issued-token' } }];

    const result = await loginJson();

    expect(result.exitCode).toBe(0);
    expect(events(result.stdout)).toEqual([
      {
        event: 'login_started',
        userCode: USER_CODE,
        approveUrl: api.approveUrl,
        expiresAt: EXPIRES_AT,
      },
      { event: 'paired', runnerId },
    ]);
    expect(await storedCredentials()).toEqual({
      serverUrl: api.serverUrl,
      runnerId,
      token: 'issued-token',
    });
  });

  it.each([
    ['denied', [{ json: { status: 'denied' } }], 'The pairing was denied in Plangineer.'],
    [
      'expired',
      [{ json: { status: 'pending' } }, { json: { status: 'expired' } }],
      'The pairing request expired. Run plangineer-runner login again.',
    ],
    ['failed poll', [internalError('Boom')], 'Boom'],
  ])(
    'prints one failed line after login_started and exits 1 for a %s request',
    async (_name, replies, message) => {
      api.pollReplies = replies;

      const result = await loginJson();

      expect(result.exitCode).toBe(1);
      expect(events(result.stdout)).toEqual([
        expect.objectContaining({ event: 'login_started' }),
        { event: 'failed', message },
      ]);
      expect(await readdir(dataDir)).toEqual([]);
    },
  );

  it('prints one failed line and exits 1 when the API cannot be reached', async () => {
    await api.close();

    const result = await loginJson();

    expect(result.exitCode).toBe(1);
    expect(events(result.stdout)).toEqual([{ event: 'failed', message: expect.any(String) }]);
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('cuts a failure message to the longest one the event allows', async () => {
    api.pollReplies = [internalError('x'.repeat(RUNNER_LOGIN_MESSAGE_MAX + 100))];

    const result = await loginJson();

    expect(events(result.stdout).at(-1)).toEqual({
      event: 'failed',
      message: 'x'.repeat(RUNNER_LOGIN_MESSAGE_MAX),
    });
  });

  it.each([
    [
      'approved',
      [{ json: { status: 'pending' } }, { json: { status: 'approved', runnerId, token: 't' } }],
    ],
    ['denied', [{ json: { status: 'pending' } }, { json: { status: 'denied' } }]],
  ])('prints nothing but event lines on stdout when %s', async (_name, replies) => {
    api.pollReplies = replies;

    const result = await loginJson();

    const lines = result.stdout.split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.stringify(RunnerLoginEvent.parse(JSON.parse(line))))).toEqual(
      lines,
    );
    expect(result.stderr).toBe('');
  });
});

async function run(
  open: (url: string) => Promise<unknown>,
  options: { openBrowser: boolean; json: boolean },
) {
  const parsed = parseRunnerEnv({ PLANGINEER_RUNNER_DATA_DIR: dataDir });
  if (!parsed.ok) throw new Error(parsed.message);
  return loginCommand(
    parsed.env,
    { serverUrl: api.serverUrl, name: 'test-runner', ...options },
    open,
  );
}

const fakeOpen = () => vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve());

describe('loginCommand', () => {
  it('opens the approval link in the browser', async () => {
    api.pollReplies = [{ json: { status: 'approved', runnerId, token: 'issued-token' } }];
    const open = fakeOpen();

    await run(open, { openBrowser: true, json: false });

    expect(open).toHaveBeenCalledExactlyOnceWith(api.approveUrl);
  });

  it('prints the link, keeps polling and succeeds when the browser cannot open', async () => {
    api.pollReplies = [
      { json: { status: 'pending' } },
      { json: { status: 'approved', runnerId, token: 'issued-token' } },
    ];
    const open = vi.fn<(url: string) => Promise<unknown>>(() =>
      Promise.reject(new Error('no browser')),
    );

    const result = await run(open, { openBrowser: true, json: false });

    expect(open).toHaveBeenCalledOnce();
    expect(result).toEqual({
      exitCode: 0,
      message: 'Paired as test-runner. Start the runner with plangineer-runner start.',
    });
  });

  it.each([
    ['--no-browser', { openBrowser: false, json: false }],
    ['--json', { openBrowser: true, json: true }],
  ])('does not open the browser with %s', async (_flag, options) => {
    api.pollReplies = [{ json: { status: 'denied' } }];
    const open = fakeOpen();

    await run(open, options);

    expect(open).not.toHaveBeenCalled();
  });
});
