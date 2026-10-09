import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startPostgres } from './postgres.ts';

describe('startPostgres', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'postgres-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('refuses a data folder from another Postgres major before running pg_ctl', async () => {
    const dataDir = path.join(root, 'postgres');
    await mkdir(dataDir);
    await writeFile(path.join(dataDir, 'PG_VERSION'), '17\n');
    // Every binary would run from this empty folder, so running any of them fails differently.
    const binDir = path.join(root, 'bin');
    await mkdir(binDir);
    const checkedPorts: number[] = [];

    await expect(
      startPostgres({
        binDir,
        dataDir,
        logFile: path.join(root, 'postgres.log'),
        databaseUrl: 'postgres://plangineer:secret@127.0.0.1:5999/plangineer',
        checkPortFree: async (port) => {
          checkedPorts.push(port);
        },
      }),
    ).rejects.toThrow(
      new Error(
        'The database was created by Postgres 17. This version of Plangineer runs Postgres 18.',
      ),
    );
    expect(checkedPorts).toEqual([]);
    expect(await readdir(root)).not.toContain('postgres.log');
  });

  it('refuses a DATABASE_URL whose database is not a plain Postgres name', async () => {
    await expect(
      startPostgres({
        binDir: path.join(root, 'bin'),
        dataDir: path.join(root, 'postgres'),
        logFile: path.join(root, 'postgres.log'),
        databaseUrl: "postgres://plangineer:secret@127.0.0.1:5999/x';DROP",
        checkPortFree: async () => {},
      }),
    ).rejects.toThrow("DATABASE_URL's database must be a lowercase Postgres name");
  });
});
