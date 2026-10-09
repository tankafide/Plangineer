import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import type { DesktopLog } from './desktop-log.ts';

/** The part of Electron's `UtilityProcess` (or a `child_process.fork` child) the desktop uses. */
export interface NodeChild {
  readonly pid?: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  once(event: 'spawn', listener: () => void): unknown;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
}

/** `utilityProcess.fork` in the app, `child_process.fork` in stack tests. */
export type ForkNode = (
  modulePath: string,
  args: string[],
  options: { env: Record<string, string>; serviceName: string },
) => NodeChild;

export interface RunningNode {
  readonly pid: number;
  /** Resolves with the exit code once the process has exited. */
  readonly exited: Promise<number>;
  /** The last non-empty line the process wrote to stderr, or '' when it wrote none. */
  lastStderrLine(): string;
}

export interface RunNodeOptions {
  modulePath: string;
  args: string[];
  /** The values this process needs, merged over the desktop's own environment. */
  env: Record<string, string>;
  serviceName: string;
  log: DesktopLog;
  /** Receives stdout lines instead of the log, for output that is read rather than logged. */
  onStdoutLine?: (line: string) => void;
}

/**
 * The one place the desktop builds a whole environment: `utilityProcess.fork` takes no partial
 * one, so the desktop's environment is copied and the process's values are merged over it.
 */
function childEnv(values: Record<string, string>): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) merged[key] = value;
  }
  return { ...merged, ...values };
}

/** How long an exited process's output may take to drain before its exit is reported. */
const OUTPUT_DRAIN_MS = 500;

/** Calls onLine for each line, resolving once the stream ends. */
function eachLine(
  stream: NodeJS.ReadableStream | null,
  onLine: (line: string) => void,
): Promise<unknown> {
  if (stream === null) return Promise.resolve();
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on('line', onLine);
  return once(lines, 'close');
}

/**
 * Forks a Node bundle once it has spawned, sends its output to the desktop log and reports its
 * exit after its output has drained, so the last stderr line is known.
 */
export async function runNode(fork: ForkNode, options: RunNodeOptions): Promise<RunningNode> {
  const { log, serviceName } = options;
  const child = fork(options.modulePath, options.args, {
    env: childEnv(options.env),
    serviceName,
  });
  const exitCode = new Promise<number>((resolve) => {
    child.once('exit', (code) => resolve(code ?? 1));
  });
  const spawned = new Promise<void>((resolve) => {
    child.once('spawn', resolve);
  });
  const stdout = child.stdout;
  const stderr = child.stderr;

  let lastStderr = '';
  const drained = Promise.all([
    eachLine(stdout, (line) => {
      if (options.onStdoutLine === undefined) log.info(`${serviceName}: ${line}`);
      else options.onStdoutLine(line);
    }),
    eachLine(stderr, (line) => {
      if (line.trim() !== '') lastStderr = line.trim();
      log.warn(`${serviceName}: ${line}`);
    }),
  ]);
  const exited = exitCode.then(async (code) => {
    await Promise.race([drained, delay(OUTPUT_DRAIN_MS)]);
    log.info(`${serviceName} exited with code ${code}`);
    return code;
  });

  const started = await Promise.race([spawned.then(() => true), exitCode.then(() => false)]);
  const pid = child.pid;
  if (!started || pid === undefined) {
    throw new Error(`${serviceName} could not start: ${lastStderr}`);
  }
  return { pid, exited, lastStderrLine: () => lastStderr };
}
