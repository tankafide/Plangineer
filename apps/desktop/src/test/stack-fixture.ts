import { fork } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { createDesktopLog, type DesktopLog } from '../desktop-log.ts';
import { desktopPaths, type DesktopPaths } from '../desktop-paths.ts';
import type { ForkNode } from '../node-process.ts';
import type { StackOptions } from '../stack.ts';
import { realStopSystem } from '../stop-process-tree.ts';

/** `apps/desktop/stage/`, which `pnpm desktop:build` fills with the bundles and Postgres. */
export const STAGE_DIR = fileURLToPath(new URL('../../stage', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('No port');
      server.close(() => resolve(address.port));
    });
  });
}

/** A forked child's exit time, so a test can measure how fast a failure is reported. */
interface ForkRecord {
  serviceName: string;
  pid: number | undefined;
  exitedAt: number | undefined;
}

/** `child_process.fork` standing in for `utilityProcess.fork`, recording each child. */
function recordingFork(records: ForkRecord[]): ForkNode {
  return (modulePath, args, { env, serviceName }) => {
    const child = fork(modulePath, args, { env, silent: true });
    const record: ForkRecord = { serviceName, pid: child.pid, exitedAt: undefined };
    records.push(record);
    child.once('exit', () => (record.exitedAt = Date.now()));
    return child;
  };
}

/** Temp config, data and log folders, two free ports and a desktop log, for one stack test. */
export interface StackFixture {
  root: string;
  paths: DesktopPaths;
  log: DesktopLog;
  forks: ForkRecord[];
  stackOptions: StackOptions;
  cleanUp(): Promise<void>;
}

export async function stackFixture(): Promise<StackFixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-stack-'));
  const folders = {
    config: path.join(root, 'config'),
    data: path.join(root, 'data'),
    log: path.join(root, 'log'),
  };
  const paths = desktopPaths(folders, STAGE_DIR);
  const log = createDesktopLog(paths.desktopLog);
  const forks: ForkRecord[] = [];
  const [apiPort, postgresPort] = [await freePort(), await freePort()];
  return {
    root,
    paths,
    log,
    forks,
    stackOptions: {
      paths,
      apiPort,
      postgresPort,
      fork: recordingFork(forks),
      log,
      stopSystem: realStopSystem,
    },
    async cleanUp() {
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    },
  };
}

function postgresBinary(name: string): string {
  return path.join(
    STAGE_DIR,
    'postgres',
    'bin',
    process.platform === 'win32' ? `${name}.exe` : name,
  );
}

/** Runs one SQL statement with the bundled psql, returning its unaligned output. */
export async function psql(databaseUrl: string, sql: string, database?: string): Promise<string> {
  const url = new URL(databaseUrl);
  const result = await execa(
    postgresBinary('psql'),
    [
      '-h',
      url.hostname,
      '-p',
      url.port,
      '-U',
      url.username,
      '-d',
      database ?? url.pathname.slice(1),
      '-tAc',
      sql,
    ],
    { env: { PGPASSWORD: decodeURIComponent(url.password) }, windowsHide: true, stdin: 'ignore' },
  );
  return result.stdout.trim();
}

/** Whether a server from the data folder is running, by `pg_ctl status`. */
export async function postgresRunning(dataDir: string): Promise<boolean> {
  const result = await execa(postgresBinary('pg_ctl'), ['status', '-D', dataDir], {
    reject: false,
    windowsHide: true,
    stdin: 'ignore',
  });
  return result.exitCode === 0;
}

/** Whether a pid still names a live process. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A session cookie for a new user in the stack's database, from the API's e2e CLI. */
export async function signedInCookie(
  serverEnv: Readonly<Record<string, string>>,
  apiLog: string,
): Promise<string> {
  const result = await execa(
    process.execPath,
    [path.join(REPO_ROOT, 'apps', 'api', 'src', 'test', 'e2e-session-cli.ts')],
    { cwd: REPO_ROOT, env: { ...serverEnv, API_LOG_FILE: apiLog } },
  );
  const cookie: unknown = JSON.parse(result.stdout);
  if (
    typeof cookie !== 'object' ||
    cookie === null ||
    !('name' in cookie) ||
    !('value' in cookie) ||
    typeof cookie.name !== 'string' ||
    typeof cookie.value !== 'string'
  ) {
    throw new Error(`The session CLI printed no cookie: ${result.stdout}`);
  }
  return `${cookie.name}=${cookie.value}`;
}
