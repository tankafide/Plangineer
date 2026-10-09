import { setTimeout as delay } from 'node:timers/promises';
import type { DesktopLog } from './desktop-log.ts';
import type { DesktopPaths } from './desktop-paths.ts';
import { type ForkNode, type RunningNode, runNode } from './node-process.ts';
import { assertPortFree } from './port-check.ts';
import { type PostgresOptions, startPostgres, stopPostgres } from './postgres.ts';
import { ensureServerEnv, requireValue, type ServerEnv } from './server-env.ts';
import { API_STOP_GRACE_MS, type StopSystem, stopProcessTree } from './stop-process-tree.ts';

const READY_POLL_MS = 250;
const READY_TIMEOUT_MS = 60_000;

export interface StackOptions {
  paths: DesktopPaths;
  /** 47100 and 47101 in the app, used only when `server.env` is first written. */
  apiPort: number;
  postgresPort: number;
  fork: ForkNode;
  log: DesktopLog;
  stopSystem: StopSystem;
}

/** The running Postgres and API. The runner is started on top of it by `runner-pairing.ts`. */
export interface LocalStack {
  serverEnv: ServerEnv;
  /** `BETTER_AUTH_URL`, the one origin of the API and the web app. */
  origin: string;
  /** Stops the API, then Postgres. */
  stop(): Promise<void>;
}

/** A failed start step, named so the dialog can say which step failed. */
export class StackStartError extends Error {
  readonly step: string;

  constructor(step: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'StackStartError';
    this.step = step;
  }
}

function exitMessage(name: string, code: number, child: RunningNode): string {
  const line = child.lastStderrLine();
  return `${name} stopped with exit code ${code}${line === '' ? '' : `: ${line}`}`;
}

async function answersOk(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return response.status === 200;
  } catch {
    // Not listening yet.
    return false;
  }
}

/** Polls until the API answers 200, failing as soon as the API exits. */
async function waitForApi(origin: string, api: RunningNode): Promise<void> {
  const url = new URL('/api/auth/ok', origin).href;
  let exitCode: number | undefined;
  void api.exited.then((code) => (exitCode = code));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exitCode !== undefined) throw new Error(exitMessage('The API', exitCode, api));
    if (await answersOk(url)) return;
    await Promise.race([delay(READY_POLL_MS), api.exited]);
  }
  throw new Error(`The API did not answer ${url} within ${READY_TIMEOUT_MS / 1000} s`);
}

/** Masks the secrets `server.env` holds in every later line of the desktop log. */
function registerSecrets(log: DesktopLog, env: ServerEnv): void {
  log.addSecret(decodeURIComponent(new URL(requireValue(env, 'DATABASE_URL')).password));
  log.addSecret(requireValue(env, 'BETTER_AUTH_SECRET'));
  log.addSecret(requireValue(env, 'SETUP_TOKEN'));
}

/**
 * Starts the local stack in a fixed order and stops at the first failure, stopping whatever had
 * started: write `server.env`, start Postgres, migrate, start the API, then wait for it. It never
 * seeds.
 */
export async function startStack(options: StackOptions): Promise<LocalStack> {
  const { paths, log } = options;
  let api: RunningNode | undefined;
  let postgres: PostgresOptions | undefined;

  async function stop(): Promise<void> {
    if (api !== undefined) await stopProcessTree(api, API_STOP_GRACE_MS, options.stopSystem);
    api = undefined;
    if (postgres !== undefined) await stopPostgres(postgres);
    postgres = undefined;
  }

  async function step<T>(name: string, action: () => Promise<T>): Promise<T> {
    log.info(`Start step: ${name}`);
    try {
      return await action();
    } catch (error) {
      log.error(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
      await stop();
      throw new StackStartError(name, error);
    }
  }

  const serverEnv = await step('Write server.env', async () => {
    const env = await ensureServerEnv({
      examplePath: paths.envExample,
      serverEnvPath: paths.serverEnv,
      apiPort: options.apiPort,
      postgresPort: options.postgresPort,
    });
    registerSecrets(log, env);
    return env;
  });
  const databaseUrl = requireValue(serverEnv, 'DATABASE_URL');
  const origin = requireValue(serverEnv, 'BETTER_AUTH_URL');

  await step('Start Postgres', async () => {
    const postgresOptions: PostgresOptions = {
      binDir: paths.postgresBin,
      dataDir: paths.postgresData,
      logFile: paths.postgresLog,
      databaseUrl,
      checkPortFree: (port) => assertPortFree('127.0.0.1', port, paths.serverEnv),
    };
    await startPostgres(postgresOptions);
    postgres = postgresOptions;
  });

  await step('Migrate the database', async () => {
    const migrate = await runNode(options.fork, {
      modulePath: paths.migrateBundle,
      args: [],
      env: { DATABASE_URL: databaseUrl },
      serviceName: 'migrate',
      log,
    });
    const code = await migrate.exited;
    if (code !== 0) throw new Error(exitMessage('The migration', code, migrate));
  });

  const started = await step('Start the API', async () => {
    const host = requireValue(serverEnv, 'API_HOST');
    await assertPortFree(host, Number(requireValue(serverEnv, 'API_PORT')), paths.serverEnv);
    api = await runNode(options.fork, {
      modulePath: paths.apiBundle,
      args: [],
      env: { ...serverEnv, API_LOG_FILE: paths.apiLog, WEB_DIST_DIR: paths.webDist },
      serviceName: 'api',
      log,
    });
    return api;
  });

  await step('Wait for the API', () => waitForApi(origin, started));

  return { serverEnv, origin, stop };
}
