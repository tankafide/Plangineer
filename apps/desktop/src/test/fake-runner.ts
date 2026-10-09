import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import type { ForkNode, NodeChild } from '../node-process.ts';
import { startRunnerPairing } from '../runner-pairing.ts';
import type { StopSystem } from '../stop-process-tree.ts';
import { memoryLog } from './memory-log.ts';

export const ORIGIN = 'http://127.0.0.1:47100';
export const RUNNER_ID = '0b9f4d3e-4f7a-4c55-9a39-0f1f6b8f2d11';

/** A forked runner the test drives: it prints lines and exits when told. */
export class FakeRunner extends EventEmitter implements NodeChild {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | undefined;

  readonly pid: number;
  readonly args: string[];

  constructor(pid: number, args: string[]) {
    super();
    this.pid = pid;
    this.args = args;
    process.nextTick(() => this.emit('spawn'));
  }

  print(event: object): void {
    this.stdout.write(`${JSON.stringify(event)}\n`);
  }

  exit(code: number, stderrLine?: string): void {
    if (this.exitCode !== undefined) return;
    this.exitCode = code;
    if (stderrLine !== undefined) this.stderr.write(`${stderrLine}\n`);
    this.stdout.end();
    this.stderr.end();
    process.nextTick(() => this.emit('exit', code));
  }
}

/** Lets streams, promises and zero-delay timers run. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await new Promise((resolve) => process.nextTick(resolve));
    await vi.advanceTimersByTimeAsync(0);
  }
}

export function setup(
  options: { signedIn?: () => boolean; approve?: (userCode: string) => Promise<void> } = {},
) {
  const forks: FakeRunner[] = [];
  const approved: string[] = [];
  const dialogs: string[] = [];
  let retry: (() => void) | undefined;
  const fork: ForkNode = (_modulePath, args) => {
    const runner = new FakeRunner(1000 + forks.length, args);
    forks.push(runner);
    return runner;
  };
  const stopSystem: StopSystem = {
    platform: 'linux',
    signal: (pid) => forks.find((runner) => runner.pid === pid)?.exit(143),
    taskkill: async () => {},
  };
  const showDialog = (message: string) => {
    dialogs.push(message);
    return new Promise<void>((resolve) => {
      retry = resolve;
    });
  };
  const pairing = startRunnerPairing({
    origin: ORIGIN,
    runnerBundle: '/resources/runner/dist/cli.mjs',
    runnerEnv: { PLANGINEER_RUNNER_DATA_DIR: '/data/runner' },
    hostname: 'workstation',
    fork,
    log: memoryLog(),
    stopSystem,
    fetch: async () => Response.json((options.signedIn ?? (() => true))() ? { user: {} } : null),
    approveLogin: async (userCode) => {
      approved.push(userCode);
      await options.approve?.(userCode);
    },
    pairingFailed: showDialog,
    runnerKeepsStopping: showDialog,
  });
  return {
    pairing,
    forks,
    approved,
    dialogs,
    clickRetry: () => retry?.(),
    commands: () => forks.map((runner) => runner.args[0]),
    latest: () => {
      const runner = forks.at(-1);
      if (runner === undefined) throw new Error('Nothing was forked');
      return runner;
    },
  };
}

/** Runs one login the way the runner prints it, approving or failing as the fake says. */
export async function login(runner: FakeRunner, userCode: string): Promise<void> {
  runner.print({
    event: 'login_started',
    userCode,
    approveUrl: `${ORIGIN}/runners/approve#code=${userCode}`,
    expiresAt: '2026-10-09T10:00:00.000Z',
  });
  await settle();
}
