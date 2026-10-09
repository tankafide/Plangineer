import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  API_STOP_GRACE_MS,
  RUNNER_STOP_GRACE_MS,
  type StopSystem,
  stopProcessTree,
} from './stop-process-tree.ts';

/** A child that exits when the test says, and a system that records what was sent to it. */
function fakes(platform: NodeJS.Platform, exitOn: NodeJS.Signals | 'taskkill' | 'never') {
  const sent: string[] = [];
  const { promise: exited, resolve } = Promise.withResolvers<number>();
  const exit = () => resolve(0);
  const system: StopSystem = {
    platform,
    signal: (pid, signal) => {
      sent.push(`${signal} ${pid}`);
      if (signal === exitOn) exit();
    },
    taskkill: async (pid) => {
      sent.push(`taskkill /pid ${pid} /T /F`);
      if (exitOn === 'taskkill') exit();
    },
  };
  return { child: { pid: 4242, exited }, system, sent };
}

describe('stopProcessTree', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs taskkill with /T /F on Windows and waits for the exit', async () => {
    const { child, system, sent } = fakes('win32', 'taskkill');

    await stopProcessTree(child, API_STOP_GRACE_MS, system);

    expect(sent).toEqual(['taskkill /pid 4242 /T /F']);
  });

  it.each(['darwin', 'linux'] as const)(
    'sends only SIGTERM on %s when the process exits within its grace',
    async (platform) => {
      const { child, system, sent } = fakes(platform, 'SIGTERM');

      await stopProcessTree(child, API_STOP_GRACE_MS, system);

      expect(sent).toEqual(['SIGTERM 4242']);
    },
  );

  it.each([
    ['the API', API_STOP_GRACE_MS, 10_000],
    ['the runner', RUNNER_STOP_GRACE_MS, 20_000],
  ])('sends SIGKILL to %s only after its grace of %i ms', async (_name, grace, expected) => {
    const { child, system, sent } = fakes('linux', 'SIGKILL');

    const stopping = stopProcessTree(child, grace, system);
    await vi.advanceTimersByTimeAsync(expected - 1);
    expect(sent).toEqual(['SIGTERM 4242']);
    await vi.advanceTimersByTimeAsync(1);
    await stopping;

    expect(sent).toEqual(['SIGTERM 4242', 'SIGKILL 4242']);
  });

  it('treats a process that already exited as stopped', async () => {
    const { system } = fakes('linux', 'never');
    const gone: StopSystem = {
      ...system,
      signal: () => {
        throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      },
    };

    await expect(
      stopProcessTree({ pid: 1, exited: Promise.resolve(0) }, API_STOP_GRACE_MS, gone),
    ).resolves.toBeUndefined();
  });
});
