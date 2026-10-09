import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';

/** The Postgres major the bundled binaries run. */
const POSTGRES_MAJOR = '18';

export interface PostgresOptions {
  /** The folder holding `initdb`, `pg_ctl`, `psql` and `createdb`. */
  binDir: string;
  dataDir: string;
  logFile: string;
  /** `server.env`'s `DATABASE_URL`, the source of the user, password, port and database. */
  databaseUrl: string;
  /** Fails the start when the port is taken, before `pg_ctl start` binds it. */
  checkPortFree(port: number): Promise<void>;
}

interface Connection {
  user: string;
  password: string;
  port: number;
  database: string;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function connection(databaseUrl: string): Connection {
  const url = new URL(databaseUrl);
  const user = decodeURIComponent(url.username);
  const database = decodeURIComponent(url.pathname.slice(1));
  for (const [name, value] of [
    ['user', user],
    ['database', database],
  ]) {
    if (!IDENTIFIER.test(value ?? '')) {
      throw new Error(`DATABASE_URL's ${name} must be a lowercase Postgres name`);
    }
  }
  return { user, password: decodeURIComponent(url.password), port: Number(url.port), database };
}

function binary(binDir: string, name: string): string {
  return path.join(binDir, process.platform === 'win32' ? `${name}.exe` : name);
}

function run(options: PostgresOptions, name: string, args: string[], env: Record<string, string>) {
  return execa(binary(options.binDir, name), args, {
    env,
    windowsHide: true,
    reject: false,
    stdin: 'ignore',
  });
}

async function runOrFail(
  options: PostgresOptions,
  name: string,
  args: string[],
  env: Record<string, string>,
): Promise<string> {
  const result = await run(options, name, args, env);
  if (result.exitCode !== 0) {
    const reason = result.stderr.trim() || `exit code ${result.exitCode}`;
    throw new Error(`${name} failed: ${reason}`);
  }
  return result.stdout;
}

async function readVersion(dataDir: string): Promise<string | undefined> {
  try {
    return (await readFile(path.join(dataDir, 'PG_VERSION'), 'utf8')).trim();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Creates the cluster with a password file that is deleted as soon as initdb has read it. */
async function initialize(options: PostgresOptions, db: Connection): Promise<void> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'plangineer-initdb-'));
  const passwordFile = path.join(tempDir, 'password');
  try {
    await writeFile(passwordFile, db.password, { mode: 0o600 });
    await runOrFail(
      options,
      'initdb',
      [
        '-D',
        options.dataDir,
        '-U',
        db.user,
        '--pwfile',
        passwordFile,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        '--locale=C',
      ],
      {},
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

/** Creates the app's database when a first run was cut off before it existed. */
async function ensureDatabase(options: PostgresOptions, db: Connection): Promise<void> {
  const env = { PGPASSWORD: db.password };
  const target = ['-h', '127.0.0.1', '-p', String(db.port), '-U', db.user];
  const found = await runOrFail(
    options,
    'psql',
    [
      ...target,
      '-d',
      'postgres',
      '-tAc',
      `SELECT 1 FROM pg_database WHERE datname = '${db.database}'`,
    ],
    env,
  );
  if (found.trim() === '') await runOrFail(options, 'createdb', [...target, db.database], env);
}

/**
 * Runs `pg_ctl start` with no pipes: the server it leaves running inherits pg_ctl's output
 * handles, so a pipe would never close. The reason for a failed start is in the server log.
 */
async function startServer(options: PostgresOptions, port: number): Promise<void> {
  await mkdir(path.dirname(options.logFile), { recursive: true });
  const result = await execa(
    binary(options.binDir, 'pg_ctl'),
    ['start', '-D', options.dataDir, '-w', '-t', '60', '-l', options.logFile],
    { env: { PGPORT: String(port) }, windowsHide: true, reject: false, stdio: 'ignore' },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `pg_ctl start failed with exit code ${result.exitCode}. The reason is in ${options.logFile}.`,
    );
  }
}

/**
 * Starts the desktop's Postgres: initializes an empty data folder, refuses another major, reuses
 * a server a crash left running from this folder, and creates the database when it is missing.
 */
export async function startPostgres(options: PostgresOptions): Promise<void> {
  const db = connection(options.databaseUrl);
  let version = await readVersion(options.dataDir);
  if (version === undefined) {
    await initialize(options, db);
    version = await readVersion(options.dataDir);
  }
  if (version !== POSTGRES_MAJOR) {
    throw new Error(
      `The database was created by Postgres ${version}. This version of Plangineer runs Postgres ${POSTGRES_MAJOR}.`,
    );
  }

  const status = await run(options, 'pg_ctl', ['status', '-D', options.dataDir], {});
  if (status.exitCode !== 0) {
    await options.checkPortFree(db.port);
    await startServer(options, db.port);
  }
  await ensureDatabase(options, db);
}

/** Stops the server fast, waiting up to 30 s. */
export async function stopPostgres(options: PostgresOptions): Promise<void> {
  await runOrFail(
    options,
    'pg_ctl',
    ['stop', '-D', options.dataDir, '-m', 'fast', '-w', '-t', '30'],
    {},
  );
}
