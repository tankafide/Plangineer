import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { shellEnv } from 'shell-env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runnerPathOverride } from './user-path.ts';

async function shellNotRead(): Promise<never> {
  throw new Error('The login shell was read on Windows');
}

describe('runnerPathOverride', () => {
  it('overrides nothing on Windows, so the runner keeps the desktop Path unchanged', async () => {
    expect(await runnerPathOverride('win32', shellNotRead)).toEqual({});
  });

  it.each(['darwin', 'linux'] as const)(
    'fails on %s when the login shell has no PATH',
    async (platform) => {
      await expect(runnerPathOverride(platform, async () => ({}))).rejects.toThrow(
        'The login shell has no PATH',
      );
    },
  );
});

describe.runIf(process.platform !== 'win32')('runnerPathOverride with a real login shell', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'user-path-'));
    vi.stubEnv('HOME', home);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true, maxRetries: 5 });
  });

  it("returns the login shell's PATH, including what the profile adds", async () => {
    const added = path.join(home, '.local', 'bin');
    await writeFile(path.join(home, '.profile'), `export PATH="${added}:$PATH"\n`);

    const { PATH } = await runnerPathOverride(process.platform, () => shellEnv('/bin/sh'));

    expect(PATH?.split(path.delimiter)).toContain(added);
  });
});
