import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readCredentials, writeCredentials } from './runner-credentials.ts';

let dir: string;
const file = () => path.join(dir, 'nested', 'runner.json');
const credentials = () => ({
  serverUrl: 'https://plangineer.example.com',
  runnerId: randomUUID(),
  token: 'runner-token',
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'runner-credentials-'));
});

afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 5 }));

describe('runner credentials', () => {
  it('reads back what it wrote, leaving no temporary file', async () => {
    const written = credentials();

    await writeCredentials(file(), written);

    expect(await readCredentials(file())).toEqual(written);
    expect(await readdir(path.dirname(file()))).toEqual(['runner.json']);
  });

  it('returns null when the runner has not been paired', async () => {
    expect(await readCredentials(file())).toBeNull();
  });

  it('rejects a file that is not valid credentials', async () => {
    await writeCredentials(file(), credentials());
    await writeFile(file(), JSON.stringify({ serverUrl: 'ftp://x', runnerId: 'x', token: '' }));

    await expect(readCredentials(file())).rejects.toThrow('serverUrl');
  });
});
