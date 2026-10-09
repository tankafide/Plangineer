import { RunnerLoginEvent } from '@plangineer/contracts';
import type { SessionFetch } from './api-client.ts';
import type { DesktopLog } from './desktop-log.ts';
import { type ForkNode, type RunningNode, runNode } from './node-process.ts';
import { RUNNER_STOP_GRACE_MS, type StopSystem, stopProcessTree } from './stop-process-tree.ts';

/** `start` exits 3 when this runner needs pairing: none, another origin, or a revoked token. */
const NEEDS_PAIRING = 3;
const SESSION_POLL_MS = 2_000;
const RESTART_DELAY_MS = 5_000;
const PAIRING_FAILURES_BEFORE_DIALOG = 3;
const STOPS_BEFORE_DIALOG = 5;

export interface RunnerPairingOptions {
  origin: string;
  runnerBundle: string;
  /** `PLANGINEER_RUNNER_DATA_DIR`, and the login shell's `PATH` outside Windows. */
  runnerEnv: Record<string, string>;
  hostname: string;
  fork: ForkNode;
  log: DesktopLog;
  stopSystem: StopSystem;
  /** The window session's `fetch`, so a session poll sees the window's sign-in. */
  fetch: SessionFetch;
  /** Approves a login request as the user signed in to the window. */
  approveLogin(userCode: string): Promise<unknown>;
  /** Shows the pairing failure dialog, resolving when the person clicks Retry. */
  pairingFailed(message: string): Promise<void>;
  /** Shows the dialog for a runner that keeps stopping, resolving when the person clicks Retry. */
  runnerKeepsStopping(message: string): Promise<void>;
}

export interface RunnerPairing {
  /** Stops the runner and every retry, and resolves once the runner has exited. */
  stop(): Promise<void>;
}

type PairingOutcome = { ok: true } | { ok: false; message: string };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A `login --json` line, or undefined when it is not a login event. */
function parseLoginEvent(line: string): RunnerLoginEvent | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = RunnerLoginEvent.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Waits on the clock, rejecting as soon as the pairing stops. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Resolves with the promise, or rejects once the pairing stops, such as with a dialog open. */
function untilStopped<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  ]);
}

/**
 * Keeps this computer's runner running against the desktop's API. It acts only on the runner's
 * exit codes and `login --json` events, never on its files: exit 3 pairs it through the window's
 * signed-in session, and any other exit starts it again after 5 s.
 */
export function startRunnerPairing(options: RunnerPairingOptions): RunnerPairing {
  const { log, origin } = options;
  const controller = new AbortController();
  const { signal } = controller;
  let current: RunningNode | undefined;

  async function runRunner(args: string[], onStdoutLine?: (line: string) => void) {
    const runner = await runNode(options.fork, {
      modulePath: options.runnerBundle,
      args,
      env: options.runnerEnv,
      serviceName: 'runner',
      log,
      ...(onStdoutLine === undefined ? {} : { onStdoutLine }),
    });
    current = runner;
    // A stop that came while the runner was spawning finds no current runner, so stop it here.
    if (signal.aborted) await stopProcessTree(runner, RUNNER_STOP_GRACE_MS, options.stopSystem);
    void runner.exited.then(() => {
      if (current === runner) current = undefined;
    });
    return runner;
  }

  async function signedIn(): Promise<boolean> {
    try {
      const url = new URL('/api/auth/get-session', origin);
      const response = await options.fetch(new Request(url));
      return response.ok && (await response.json()) !== null;
    } catch (error) {
      log.warn(`The session check failed: ${messageOf(error)}`);
      return false;
    }
  }

  /** One `login --json`, approved as the signed-in user. */
  async function pairOnce(): Promise<PairingOutcome> {
    let failure: string | undefined;
    let paired = false;
    let approval: Promise<void> = Promise.resolve();
    const login = await runRunner(
      ['login', '--server', origin, '--name', options.hostname, '--json'],
      (line) => {
        const parsed = parseLoginEvent(line);
        if (parsed === undefined) {
          failure = 'The runner printed a line that is not a login event';
          return;
        }
        const event = parsed;
        log.info(`Runner login: ${event.event}`);
        if (event.event === 'login_started') {
          approval = options.approveLogin(event.userCode).then(
            () => undefined,
            async (error: unknown) => {
              failure = `The login request could not be approved: ${messageOf(error)}`;
              await stopProcessTree(login, RUNNER_STOP_GRACE_MS, options.stopSystem);
            },
          );
        } else if (event.event === 'paired') paired = true;
        else failure = event.message;
      },
    );
    const code = await login.exited;
    await approval;
    if (code === 0 && paired && failure === undefined) return { ok: true };
    const stderr = login.lastStderrLine();
    return {
      ok: false,
      message:
        failure ??
        `The runner login stopped with exit code ${code}${stderr === '' ? '' : `: ${stderr}`}`,
    };
  }

  /** Polls the window's session and pairs once someone is signed in, until a pairing succeeds. */
  async function pairUntilDone(): Promise<void> {
    let failures = 0;
    for (;;) {
      if (await signedIn()) {
        const outcome = await pairOnce();
        if (signal.aborted) return;
        if (outcome.ok) return;
        log.warn(`The runner could not be paired: ${outcome.message}`);
        failures += 1;
        if (failures >= PAIRING_FAILURES_BEFORE_DIALOG) {
          await untilStopped(
            options.pairingFailed(`This computer's runner could not be paired: ${outcome.message}`),
            signal,
          );
          failures = 0;
        }
      }
      await sleep(SESSION_POLL_MS, signal);
    }
  }

  async function supervise(): Promise<void> {
    let stops = 0;
    while (!signal.aborted) {
      const runner = await runRunner(['start', '--server', origin]);
      const code = await runner.exited;
      if (signal.aborted) return;
      if (code === NEEDS_PAIRING) {
        stops = 0;
        await pairUntilDone();
        continue;
      }
      stops += 1;
      if (stops >= STOPS_BEFORE_DIALOG) {
        await untilStopped(
          options.runnerKeepsStopping(
            `This computer's runner keeps stopping: ${runner.lastStderrLine()}`,
          ),
          signal,
        );
        stops = 0;
        continue;
      }
      await sleep(RESTART_DELAY_MS, signal);
    }
  }

  const supervising = supervise().catch((error: unknown) => {
    if (!signal.aborted) log.error(`The runner supervisor stopped: ${messageOf(error)}`);
  });

  return {
    async stop() {
      controller.abort();
      const runner = current;
      if (runner !== undefined) {
        await stopProcessTree(runner, RUNNER_STOP_GRACE_MS, options.stopSystem);
      }
      await supervising;
    },
  };
}
