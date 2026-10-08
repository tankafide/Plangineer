import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRunnerEnv } from './config/runner-env.ts';
import { loginCommand } from './login-command.ts';

const cliPath = fileURLToPath(new URL('cli.ts', import.meta.url));
const runnerId = randomUUID();
const USER_CODE = 'ABCD-EFGH-JKMN';
const DEVICE_SECRET = 'A'.repeat(43);

interface RecordedRequest {
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

type Reply = { status?: number; json: unknown };

let server: Server;
let serverUrl: string;
let dataDir: string;
let requests: RecordedRequest[];
let startReply: Reply;
let pollReplies: Reply[];

const startOutput = () => ({
  deviceSecret: DEVICE_SECRET,
  userCode: USER_CODE,
  approveUrl: `${serverUrl}/runners/approve?code=${USER_CODE}`,
  expiresAt: '2026-10-08T12:00:00.000Z',
  pollIntervalMs: 20,
});

/** Answers `runner.startLogin` and `runner.pollLogin` in oRPC's RPC wire format, as the API would. */
function startFakeApi(): Promise<string> {
  server = createServer((request, response) => {
    void text(request).then((body) => {
      requests.push({ path: request.url, headers: request.headers, body: JSON.parse(body) });
      const reply =
        request.url === '/rpc/runner/startLogin'
          ? startReply
          : (pollReplies.shift() ?? pollReplies.at(-1));
      response.writeHead(reply?.status ?? 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ json: reply?.json, meta: [] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

const tooManyRequests = {
  status: 429,
  json: { defined: true, code: 'TOO_MANY_REQUESTS', status: 429, message: 'Too many' },
};

function login(...args: string[]) {
  return execa(
    process.execPath,
    [cliPath, 'login', '--server', serverUrl, '--name', 'test-runner', '--no-browser', ...args],
    { reject: false, env: { PLANGINEER_RUNNER_DATA_DIR: dataDir } },
  );
}

beforeEach(async () => {
  requests = [];
  startReply = { json: undefined };
  pollReplies = [];
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-login-'));
  serverUrl = await startFakeApi();
  startReply = { json: startOutput() };
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('login', () => {
  it('prints the link and user code, polls to approved, and stores the token in runner.json', async () => {
    pollReplies = [
      { json: { status: 'pending' } },
      { json: { status: 'approved', runnerId, token: 'issued-token' } },
    ];

    const result = await login();

    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n')).toEqual([
      `To pair this machine, approve it in Plangineer: ${serverUrl}/runners/approve?code=${USER_CODE}`,
      `Code: ${USER_CODE}`,
      'Paired as test-runner. Start the runner with plangineer-runner start.',
    ]);
    expect(requests.map((request) => request.path)).toEqual([
      '/rpc/runner/startLogin',
      '/rpc/runner/pollLogin',
      '/rpc/runner/pollLogin',
    ]);
    expect(requests[0]).toMatchObject({
      headers: expect.objectContaining({ 'x-csrf-token': 'orpc' }),
      body: { json: { name: 'test-runner', platform: process.platform } },
    });
    expect(requests[1]?.body).toEqual({ json: { deviceSecret: DEVICE_SECRET } });
    const stored: unknown = JSON.parse(await readFile(path.join(dataDir, 'runner.json'), 'utf8'));
    expect(stored).toEqual({ serverUrl, runnerId, token: 'issued-token' });
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
      pollReplies = replies;

      const result = await login();

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe(message);
      expect(await readdir(dataDir)).toEqual([]);
    },
  );

  it('exits 1 with a message and polls nothing when the API has too many pending requests', async () => {
    startReply = tooManyRequests;

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'Too many pairing requests are waiting in Plangineer. Try again in a few minutes.',
    );
    expect(requests).toHaveLength(1);
    expect(await readdir(dataDir)).toEqual([]);
  });

  it('exits 1 with the error message when the API cannot be reached', async () => {
    await new Promise((resolve) => server.close(resolve));

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toBe('');
    expect(await readdir(dataDir)).toEqual([]);
    server = createServer();
  });

  it('exits 1 with the error message when a poll fails', async () => {
    pollReplies = [
      {
        status: 500,
        json: { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'Boom' },
      },
    ];

    const result = await login();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe('Boom');
    expect(await readdir(dataDir)).toEqual([]);
  });
});

async function run(open: (url: string) => Promise<unknown>, openBrowser: boolean) {
  const parsed = parseRunnerEnv({ PLANGINEER_RUNNER_DATA_DIR: dataDir });
  if (!parsed.ok) throw new Error(parsed.message);
  return loginCommand(parsed.env, { serverUrl, name: 'test-runner', openBrowser }, open);
}

describe('loginCommand', () => {
  it('opens the approval link in the browser', async () => {
    pollReplies = [{ json: { status: 'approved', runnerId, token: 'issued-token' } }];
    const open = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve());

    await run(open, true);

    expect(open).toHaveBeenCalledExactlyOnceWith(`${serverUrl}/runners/approve?code=${USER_CODE}`);
  });

  it('prints the link, keeps polling and succeeds when the browser cannot open', async () => {
    pollReplies = [
      { json: { status: 'pending' } },
      { json: { status: 'approved', runnerId, token: 'issued-token' } },
    ];
    const open = vi.fn<(url: string) => Promise<unknown>>(() =>
      Promise.reject(new Error('no browser')),
    );

    const result = await run(open, true);

    expect(open).toHaveBeenCalledOnce();
    expect(result).toEqual({
      ok: true,
      message: 'Paired as test-runner. Start the runner with plangineer-runner start.',
    });
  });

  it('does not open the browser with --no-browser', async () => {
    pollReplies = [{ json: { status: 'denied' } }];
    const open = vi.fn<(url: string) => Promise<unknown>>(() => Promise.resolve());

    await run(open, false);

    expect(open).not.toHaveBeenCalled();
  });
});
