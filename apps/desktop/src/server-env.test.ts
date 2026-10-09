import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureServerEnv } from './server-env.ts';

const EXAMPLE = [
  '# API',
  'DATABASE_URL=postgres://plangineer:plangineer@localhost:5432/plangineer',
  'API_HOST=0.0.0.0',
  'API_PORT=3000',
  'API_LOG_FILE=../../logs/api.log',
  'LOG_LEVEL=info',
  'BETTER_AUTH_SECRET=replace-with-32-or-more-random-characters',
  'BETTER_AUTH_URL=http://localhost:5173',
  'SETUP_TOKEN=replace-with-a-setup-token',
  'RUNNER_LOGIN_TTL_MS=600000',
  '# WEB_DIST_DIR=<absolute path>',
  '',
].join('\n');

const BASE64URL_32_BYTES = /^[A-Za-z0-9_-]{43}$/;

describe('ensureServerEnv', () => {
  let root: string;
  let examplePath: string;
  let serverEnvPath: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'server-env-'));
    examplePath = path.join(root, 'env.example');
    serverEnvPath = path.join(root, 'config', 'server.env');
    await writeFile(examplePath, EXAMPLE);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  const ensure = () =>
    ensureServerEnv({ examplePath, serverEnvPath, apiPort: 47100, postgresPort: 47101 });
  const readStored = async () => parseEnv(await readFile(serverEnvPath, 'utf8'));

  it('writes every example key except API_LOG_FILE, with the six overrides', async () => {
    await ensure();
    const stored = await readStored();

    expect(Object.keys(stored).toSorted()).toEqual(
      [
        'DATABASE_URL',
        'API_HOST',
        'API_PORT',
        'LOG_LEVEL',
        'BETTER_AUTH_SECRET',
        'BETTER_AUTH_URL',
        'SETUP_TOKEN',
        'RUNNER_LOGIN_TTL_MS',
      ].toSorted(),
    );
    expect(stored['API_HOST']).toBe('127.0.0.1');
    expect(stored['API_PORT']).toBe('47100');
    expect(stored['BETTER_AUTH_URL']).toBe('http://127.0.0.1:47100');
    expect(stored['LOG_LEVEL']).toBe('info');
    expect(stored['RUNNER_LOGIN_TTL_MS']).toBe('600000');
    expect(stored['BETTER_AUTH_SECRET']).toMatch(BASE64URL_32_BYTES);
    expect(stored['SETUP_TOKEN']).toMatch(BASE64URL_32_BYTES);
    expect(stored['SETUP_TOKEN']).not.toBe(stored['BETTER_AUTH_SECRET']);

    const database = new URL(stored['DATABASE_URL'] ?? '');
    expect(database.username).toBe('plangineer');
    expect(database.password).toMatch(BASE64URL_32_BYTES);
    expect(database.host).toBe('127.0.0.1:47101');
    expect(database.pathname).toBe('/plangineer');
  });

  it.runIf(process.platform !== 'win32')('writes the file with mode 0600', async () => {
    await ensure();

    expect((await stat(serverEnvPath)).mode & 0o777).toBe(0o600);
  });

  it('returns the stored values, and a second call changes nothing', async () => {
    const first = await ensure();
    const text = await readFile(serverEnvPath, 'utf8');

    const second = await ensure();

    expect(await readFile(serverEnvPath, 'utf8')).toBe(text);
    expect(second).toEqual(first);
    expect(first).toEqual(await readStored());
  });

  it('appends a key the example gained, keeping every existing value and line', async () => {
    await ensure();
    const before = await readStored();
    await writeFile(serverEnvPath, `${await readFile(serverEnvPath, 'utf8')}PERSON_ADDED=yes`);
    await writeFile(examplePath, `${EXAMPLE}NEW_SETTING=42\n`);

    const values = await ensure();

    const after = await readStored();
    expect(after).toEqual({ ...before, PERSON_ADDED: 'yes', NEW_SETTING: '42' });
    expect(values).toEqual(after);
  });

  it('never appends API_LOG_FILE', async () => {
    await ensure();
    await writeFile(examplePath, `${EXAMPLE}NEW_SETTING=42\n`);

    await ensure();

    expect(await readStored()).not.toHaveProperty('API_LOG_FILE');
  });

  it('keeps a value the person edited', async () => {
    await ensure();
    const text = await readFile(serverEnvPath, 'utf8');
    await writeFile(serverEnvPath, text.replace('API_PORT=47100', 'API_PORT=47200'));

    const values = await ensure();

    expect(values['API_PORT']).toBe('47200');
  });
});
