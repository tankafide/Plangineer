import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureDatabase, type PostgresOptions, startPostgres, stopPostgres } from './postgres.ts';
import { freePort, postgresRunning, psql, STAGE_DIR } from './test/stack-fixture.ts';

describe('postgres with the real Postgres 18.6.0 binaries', () => {
  let root: string;
  let options: PostgresOptions;
  let checkedPorts: number[];

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-postgres-'));
    checkedPorts = [];
    const port = await freePort();
    options = {
      binDir: path.join(STAGE_DIR, 'postgres', 'bin'),
      dataDir: path.join(root, 'postgres'),
      logFile: path.join(root, 'log', 'postgres.log'),
      databaseUrl: `postgres://plangineer:${encodeURIComponent('generated/pass+word=')}@127.0.0.1:${port}/plangineer`,
      checkPortFree: async (checked) => {
        checkedPorts.push(checked);
      },
    };
  });

  afterEach(async () => {
    if (await postgresRunning(options.dataDir)) await stopPostgres(options);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('initializes an empty folder, starts on localhost, stops, and starts again with the data kept', async () => {
    await startPostgres(options);
    await ensureDatabase(options);

    expect(await psql(options.databaseUrl, 'SELECT current_user')).toBe('plangineer');
    expect(await psql(options.databaseUrl, 'SHOW listen_addresses')).toBe('localhost');
    await psql(options.databaseUrl, 'CREATE TABLE kept (id int); INSERT INTO kept VALUES (7)');
    const wrongPassword = new URL(options.databaseUrl);
    wrongPassword.password = 'wrong';
    await expect(psql(wrongPassword.href, 'SELECT 1')).rejects.toThrow(
      'password authentication failed',
    );

    await stopPostgres(options);
    expect(await postgresRunning(options.dataDir)).toBe(false);

    await startPostgres(options);
    await ensureDatabase(options);
    expect(await psql(options.databaseUrl, 'SELECT id FROM kept')).toBe('7');
  });

  it('uses a server already running from the data folder and runs no pg_ctl start', async () => {
    await startPostgres(options);
    await ensureDatabase(options);
    checkedPorts = [];

    await startPostgres(options);
    await ensureDatabase(options);

    // The port check runs only before pg_ctl start, which a running server would fail.
    expect(checkedPorts).toEqual([]);
    expect(await psql(options.databaseUrl, 'SELECT 1')).toBe('1');
  });

  it('creates the database on the next start when a first run stopped before createdb', async () => {
    await startPostgres(options);
    await ensureDatabase(options);
    await psql(options.databaseUrl, 'DROP DATABASE plangineer', 'postgres');
    await stopPostgres(options);

    await startPostgres(options);
    await ensureDatabase(options);

    expect(await psql(options.databaseUrl, 'SELECT current_database()')).toBe('plangineer');
  });
});
