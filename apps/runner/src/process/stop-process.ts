import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';

/** How long a child has to finish its turn after SIGINT before its group is killed. */
const STOP_GRACE_MS = 10_000;
/** taskkill's exit code when the process has already exited. */
const TASKKILL_NOT_FOUND = 128;

/** A spawned child as the stop function needs it. */
export interface RunningProcess {
  readonly pid: number | undefined;
  /** Resolves when the child has exited. */
  readonly exited: Promise<void>;
  hasExited(): boolean;
}

/** Tracks an execa child, whose promise settles when it exits. */
export function trackProcess(child: PromiseLike<unknown> & { pid?: number | undefined }) {
  let exited = false;
  const done = Promise.resolve(child).then(() => {
    exited = true;
  });
  return { pid: child.pid, exited: done, hasExited: () => exited } satisfies RunningProcess;
}

/** The `taskkill` arguments that force-stop a process and every process it started. */
export function taskkillArgs(pid: number): string[] {
  return ['/pid', String(pid), '/T', '/F'];
}

/** Signals a process group, treating a group that is already gone as stopped. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
}

async function stopPosix(child: RunningProcess, pid: number): Promise<void> {
  signalGroup(pid, 'SIGINT');
  const graceOver = new AbortController();
  const outcome = await Promise.race([
    child.exited.then(() => 'exited' as const),
    delay(STOP_GRACE_MS, 'grace_over' as const, { signal: graceOver.signal }),
  ]);
  graceOver.abort();
  if (outcome === 'grace_over') {
    signalGroup(pid, 'SIGKILL');
    await child.exited;
  }
}

async function stopWindows(child: RunningProcess, pid: number): Promise<void> {
  const result = await execa('taskkill', taskkillArgs(pid), { reject: false });
  if (result.exitCode !== 0 && result.exitCode !== TASKKILL_NOT_FOUND) {
    throw new Error(`taskkill could not stop process ${pid}: ${result.stderr}`, { cause: result });
  }
  await child.exited;
}

/**
 * Stops a child spawned detached and everything it started. On macOS and Linux it sends SIGINT to
 * the process group, so Claude Code can finish its turn, then SIGKILL after a grace period. On
 * Windows, which has no signals to send, it runs `taskkill /T /F`. Resolves once the child exited.
 */
export async function stopProcess(child: RunningProcess): Promise<void> {
  const { pid } = child;
  if (pid === undefined || child.hasExited()) return;
  if (process.platform === 'win32') await stopWindows(child, pid);
  else await stopPosix(child, pid);
}
