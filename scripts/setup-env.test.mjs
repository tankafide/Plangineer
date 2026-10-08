import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseEnv as parseApiEnv } from '../apps/api/src/env.ts';
import { repoRoot } from './script-entry.mjs';
import { setupEnv } from './setup-env.mjs';

describe('setupEnv', () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'setup-env-'));
    await copyFile(path.join(repoRoot, '.env.example'), path.join(root, '.env.example'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('creates .env from the example with a 43-character BETTER_AUTH_SECRET', async () => {
    expect(await setupEnv(root)).toBe(0);

    const env = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
    const example = parseEnv(await readFile(path.join(root, '.env.example'), 'utf8'));
    const placeholders = [
      'BETTER_AUTH_SECRET',
      'GITHUB_APP_ID',
      'GITHUB_APP_SLUG',
      'GITHUB_APP_PRIVATE_KEY',
    ];
    const without = (values) =>
      Object.fromEntries(Object.entries(values).filter(([key]) => !placeholders.includes(key)));
    expect(env.BETTER_AUTH_SECRET).toMatch(/^[\w-]{43}$/);
    expect(env.GITHUB_APP_ID).toBe('1');
    expect(env.GITHUB_APP_SLUG).toBe('plangineer-dev');
    expect(env.GITHUB_APP_PRIVATE_KEY).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n/);
    expect(without(env)).toEqual(without(example));
  });

  it('writes a .env the API accepts', async () => {
    await setupEnv(root);

    const env = parseEnv(await readFile(path.join(root, '.env'), 'utf8'));
    expect(() => parseApiEnv(env)).not.toThrow();
  });

  it('refuses to run when .env exists, leaving it unchanged', async () => {
    await writeFile(path.join(root, '.env'), 'KEEP=1\n');

    expect(await setupEnv(root)).toBe(1);
    expect(await readFile(path.join(root, '.env'), 'utf8')).toBe('KEEP=1\n');
  });
});
