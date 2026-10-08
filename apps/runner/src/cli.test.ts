import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const cliPath = fileURLToPath(new URL('cli.ts', import.meta.url));
const manifestPath = fileURLToPath(new URL('../package.json', import.meta.url));

describe('plangineer-runner CLI', () => {
  let cwd: string;

  beforeAll(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'plangineer-runner-'));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true, maxRetries: 5 });
  });

  it('prints the package version for --version', async () => {
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));

    const result = await execa(process.execPath, [cliPath, '--version'], { cwd });

    expect(result.exitCode).toBe(0);
    expect(manifest).toHaveProperty('version', result.stdout);
  });

  it.each([[[]], [['--help']], [['--version', 'extra']]])(
    'prints the usage line and exits 1 for arguments %j',
    async (args) => {
      const result = await execa(process.execPath, [cliPath, ...args], { cwd, reject: false });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe('Usage: plangineer-runner --version');
    },
  );
});
