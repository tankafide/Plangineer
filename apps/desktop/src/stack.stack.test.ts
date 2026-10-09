import { readFile, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureServerEnv } from './server-env.ts';
import { type LocalStack, StackStartError, startStack } from './stack.ts';
import {
  postgresRunning,
  processAlive,
  type StackFixture,
  stackFixture,
} from './test/stack-fixture.ts';

function occupy(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function startFailure(fixture: StackFixture): Promise<StackStartError> {
  try {
    await startStack(fixture.stackOptions);
  } catch (error) {
    if (error instanceof StackStartError) return error;
    throw error;
  }
  throw new Error('The stack started');
}

describe('startStack with the built bundles and real Postgres', () => {
  let fixture: StackFixture;
  let stack: LocalStack | undefined;
  let busy: Server | undefined;

  beforeEach(async () => {
    fixture = await stackFixture();
  });

  afterEach(async () => {
    await stack?.stop();
    stack = undefined;
    await new Promise((resolve) => (busy === undefined ? resolve(undefined) : busy.close(resolve)));
    busy = undefined;
    await fixture.cleanUp();
  });

  it('reaches /api/auth/ok within 15 s on a warm start, and stopping leaves no process', async () => {
    await (await startStack(fixture.stackOptions)).stop();

    const started = Date.now();
    stack = await startStack(fixture.stackOptions);
    const elapsed = Date.now() - started;

    const ok = await fetch(new URL('/api/auth/ok', stack.origin));
    expect(ok.status).toBe(200);
    expect(elapsed).toBeLessThan(15_000);
    const index = await fetch(new URL('/get-started', stack.origin));
    expect(await index.text()).toContain('<div id="root">');

    await stack.stop();
    stack = undefined;

    expect(await postgresRunning(fixture.paths.postgresData)).toBe(false);
    const alive = fixture.forks.filter(({ pid }) => pid !== undefined && processAlive(pid));
    expect(alive).toEqual([]);
  });

  it('fails a busy Postgres port with the port-in-use message before starting anything', async () => {
    busy = await occupy(fixture.stackOptions.postgresPort);

    const error = await startFailure(fixture);

    expect(error.step).toBe('Start Postgres');
    expect(error.message).toBe(
      `Port ${fixture.stackOptions.postgresPort} is in use by another program. Free it, or change the port in ${fixture.paths.serverEnv} as the desktop app guide describes.`,
    );
    expect(await postgresRunning(fixture.paths.postgresData)).toBe(false);
    expect(fixture.forks).toEqual([]);
  });

  it('fails a busy API port with the port-in-use message before the API starts', async () => {
    busy = await occupy(fixture.stackOptions.apiPort);

    const error = await startFailure(fixture);

    expect(error.step).toBe('Start the API');
    expect(error.message).toBe(
      `Port ${fixture.stackOptions.apiPort} is in use by another program. Free it, or change the port in ${fixture.paths.serverEnv} as the desktop app guide describes.`,
    );
    expect(fixture.forks.map((child) => child.serviceName)).toEqual(['migrate']);
    expect(await postgresRunning(fixture.paths.postgresData)).toBe(false);
  });

  it('fails within 1 s of an API exit during startup, with its exit code and last stderr line', async () => {
    await ensureServerEnv({
      examplePath: fixture.paths.envExample,
      serverEnvPath: fixture.paths.serverEnv,
      apiPort: fixture.stackOptions.apiPort,
      postgresPort: fixture.stackOptions.postgresPort,
    });
    const text = await readFile(fixture.paths.serverEnv, 'utf8');
    await writeFile(fixture.paths.serverEnv, text.replace('LOG_LEVEL=info', 'LOG_LEVEL=loud'));

    const error = await startFailure(fixture);

    expect(error.step).toBe('Wait for the API');
    expect(error.message).toMatch(/^The API stopped with exit code 1: .*LOG_LEVEL/);
    // The failure is logged when it is found, before the stack stops Postgres.
    const failedLine = (await readFile(fixture.paths.desktopLog, 'utf8'))
      .split(/\r?\n/)
      .find((line) => line.includes('Wait for the API failed'));
    const failedAt = Date.parse(failedLine?.split(' ')[0] ?? '');
    const api = fixture.forks.find((child) => child.serviceName === 'api');
    expect(failedAt - (api?.exitedAt ?? Number.NaN)).toBeLessThan(1_000);
    expect(await postgresRunning(fixture.paths.postgresData)).toBe(false);
  });
});
