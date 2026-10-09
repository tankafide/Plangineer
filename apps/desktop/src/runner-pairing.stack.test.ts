import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDesktopClient, type SessionFetch } from './api-client.ts';
import { type RunnerPairing, startRunnerPairing } from './runner-pairing.ts';
import { type LocalStack, startStack } from './stack.ts';
import { realStopSystem } from './stop-process-tree.ts';
import {
  postgresRunning,
  processAlive,
  type StackFixture,
  signedInCookie,
  stackFixture,
} from './test/stack-fixture.ts';

/** Stands in for the window session's fetch: every request carries the signed-in cookie. */
function cookieFetch(cookie: string): SessionFetch {
  return (input, init) => {
    const request = new Request(input, init);
    request.headers.set('cookie', cookie);
    return fetch(request);
  };
}

async function until<T>(read: () => Promise<T | undefined>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(250);
  }
  throw new Error(`Not reached within ${timeoutMs} ms`);
}

async function readCredentials(
  file: string,
): Promise<{ runnerId: string; token: string } | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (
      typeof value === 'object' &&
      value !== null &&
      'runnerId' in value &&
      'token' in value &&
      typeof value.runnerId === 'string' &&
      typeof value.token === 'string'
    ) {
      return { runnerId: value.runnerId, token: value.token };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

describe('runner pairing against the built API and runner bundles', () => {
  let fixture: StackFixture;
  let stack: LocalStack | undefined;
  let pairing: RunnerPairing | undefined;

  beforeEach(async () => {
    fixture = await stackFixture();
  });

  afterEach(async () => {
    await pairing?.stop();
    await stack?.stop();
    await fixture.cleanUp();
  });

  it('pairs the runner as the signed-in user, keeps secrets out of desktop.log, and stops cleanly', async () => {
    stack = await startStack(fixture.stackOptions);
    const cookie = await signedInCookie(
      stack.serverEnv,
      path.join(fixture.root, 'session-api.log'),
    );
    const fetch = cookieFetch(cookie);
    const client = createDesktopClient(stack.origin, fetch);
    const dialogs: string[] = [];

    pairing = startRunnerPairing({
      origin: stack.origin,
      runnerBundle: fixture.paths.runnerBundle,
      runnerEnv: { PLANGINEER_RUNNER_DATA_DIR: fixture.paths.runnerData },
      hostname: os.hostname(),
      fork: fixture.stackOptions.fork,
      log: fixture.log,
      stopSystem: realStopSystem,
      fetch,
      approveLogin: (userCode) => client.runner.approveLogin({ userCode }),
      pairingFailed: async (message) => {
        dialogs.push(message);
      },
      runnerKeepsStopping: async (message) => {
        dialogs.push(message);
      },
    });

    const credentials = await until(
      () => readCredentials(path.join(fixture.paths.runnerData, 'runner.json')),
      60_000,
    );
    const online = await until(async () => {
      const { items } = await client.runner.list({});
      return items.find((runner) => runner.id === credentials.runnerId && runner.online);
    }, 60_000);

    expect(online.name).toBe(os.hostname());
    expect(dialogs).toEqual([]);
    const commands = fixture.forks.map((child) => child.serviceName);
    expect(commands).toEqual(['migrate', 'api', 'runner', 'runner', 'runner']);

    const password = decodeURIComponent(new URL(stack.serverEnv['DATABASE_URL'] ?? '').password);
    await pairing.stop();
    pairing = undefined;
    await stack.stop();
    stack = undefined;

    const log = await readFile(fixture.paths.desktopLog, 'utf8');
    expect(log).toContain('Runner login: paired');
    expect(log).not.toContain(password);
    expect(log).not.toContain(credentials.token);
    expect(await postgresRunning(fixture.paths.postgresData)).toBe(false);
    const alive = fixture.forks.filter(({ pid }) => pid !== undefined && processAlive(pid));
    expect(alive).toEqual([]);
  });
});
