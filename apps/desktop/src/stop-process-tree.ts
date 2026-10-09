import { execa } from 'execa';

/** How long the API gets to exit after SIGTERM before SIGKILL. */
export const API_STOP_GRACE_MS = 10_000;
/** Longer than the runner's own 10 s STOP_GRACE_MS, so it stops its agents' groups first. */
export const RUNNER_STOP_GRACE_MS = 20_000;

/** What the stop needs from the system, so each branch is tested on every system. */
export interface StopSystem {
  platform: NodeJS.Platform;
  signal(pid: number, signal: NodeJS.Signals): void;
  taskkill(pid: number): Promise<unknown>;
}

export const realStopSystem: StopSystem = {
  platform: process.platform,
  signal: (pid, signal) => process.kill(pid, signal),
  taskkill: (pid) =>
    execa('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, reject: false }),
};

export interface Stoppable {
  readonly pid: number;
  readonly exited: Promise<unknown>;
}

/** Signals a pid that may already have exited, which is not an error. */
function signalIfAlive(system: StopSystem, pid: number, signal: NodeJS.Signals): void {
  try {
    system.signal(pid, signal);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
  }
}

/**
 * Stops a forked Node process and waits for its exit. On Windows `taskkill /T /F` ends it and
 * its children. Elsewhere it gets SIGTERM, since a `utilityProcess` child cannot be detached into
 * its own group, and SIGKILL once `graceMs` passes.
 */
export async function stopProcessTree(
  child: Stoppable,
  graceMs: number,
  system: StopSystem,
): Promise<void> {
  if (system.platform === 'win32') {
    await system.taskkill(child.pid);
    await child.exited;
    return;
  }
  signalIfAlive(system, child.pid, 'SIGTERM');
  let timer: NodeJS.Timeout | undefined;
  const grace = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), graceMs);
  });
  const outcome = await Promise.race([child.exited.then(() => 'exited' as const), grace]);
  clearTimeout(timer);
  if (outcome === 'timeout') {
    signalIfAlive(system, child.pid, 'SIGKILL');
    await child.exited;
  }
}
