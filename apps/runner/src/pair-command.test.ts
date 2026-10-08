import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('cli.ts', import.meta.url));
const VALID_CODE = 'ABCD-EFGH-JKMN';
const runnerId = randomUUID();

interface PairRequest {
  path: string | undefined;
  headers: IncomingHttpHeaders;
  body: unknown;
}

let server: Server;
let serverUrl: string;
let dataDir: string;
let requests: PairRequest[];

/** Answers `runner.pair` in oRPC's RPC wire format, as the API would. */
function startPairServer(): Promise<string> {
  server = createServer((request, response) => {
    void text(request).then((body) => {
      const parsed: unknown = JSON.parse(body);
      requests.push({ path: request.url, headers: request.headers, body: parsed });
      const accepted = JSON.stringify(parsed).includes(VALID_CODE);
      response.writeHead(accepted ? 200 : 401, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          json: accepted
            ? { runnerId, token: 'issued-token' }
            : { defined: true, code: 'PAIRING_CODE_REJECTED', status: 401, message: 'Rejected' },
          meta: [],
        }),
      );
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

function pair(code: string) {
  return execa(
    process.execPath,
    [cliPath, 'pair', '--server', serverUrl, '--code', code, '--name', 'test-runner'],
    { reject: false, env: { PLANGINEER_RUNNER_DATA_DIR: dataDir } },
  );
}

beforeEach(async () => {
  requests = [];
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'runner-pair-'));
  serverUrl = await startPairServer();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

describe('pair', () => {
  it('exchanges the code for a token and stores it in runner.json', async () => {
    const result = await pair(VALID_CODE);

    expect(result.stdout).toBe('Paired as test-runner. Start the runner with pnpm runner start.');
    expect(result.exitCode).toBe(0);
    expect(requests).toEqual([
      {
        path: '/rpc/runner/pair',
        headers: expect.objectContaining({ 'x-csrf-token': 'orpc' }),
        body: { json: { code: VALID_CODE, name: 'test-runner', platform: process.platform } },
      },
    ]);
    const stored: unknown = JSON.parse(await readFile(path.join(dataDir, 'runner.json'), 'utf8'));
    expect(stored).toEqual({ serverUrl, runnerId, token: 'issued-token' });
  });

  it('exits 1 with the message and writes nothing for a rejected code', async () => {
    const result = await pair('ZZZZ-ZZZZ-ZZZZ');

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'That pairing code is invalid or expired. Create a new one in Plangineer.',
    );
    expect(await readdir(dataDir)).toEqual([]);
  });
});
