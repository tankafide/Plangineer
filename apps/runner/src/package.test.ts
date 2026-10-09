import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';
import { build } from 'tsdown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const RUNNER_DIR = fileURLToPath(new URL('..', import.meta.url));
const PackResult = z.array(z.object({ files: z.array(z.object({ path: z.string() })) }));

/**
 * The package as npm would publish it: the built CLI beside a copy of package.json and the
 * README. It sits in the temp folder, so no node_modules can resolve a dependency it lacks.
 */
describe('the published package', () => {
  let packageDir: string;
  let fixture: string;
  const cli = () => path.join(packageDir, 'dist', 'cli.mjs');

  beforeAll(async () => {
    packageDir = await mkdtemp(path.join(os.tmpdir(), 'runner-package-'));
    await build({ cwd: RUNNER_DIR, outDir: path.join(packageDir, 'dist'), logLevel: 'silent' });
    await copyFile(path.join(RUNNER_DIR, 'package.json'), path.join(packageDir, 'package.json'));
    await copyFile(path.join(RUNNER_DIR, 'README.md'), path.join(packageDir, 'README.md'));
    fixture = await mkdtemp(path.join(os.tmpdir(), 'runner-package-fixture-'));
    for (const root of ['.agents', '.claude']) {
      await mkdir(path.join(fixture, root, 'skills', 'alpha'), { recursive: true });
      await writeFile(path.join(fixture, root, 'skills', 'alpha', 'SKILL.md'), 'alpha\n');
    }
  }, 60_000);

  afterAll(async () => {
    await rm(packageDir, { recursive: true, force: true, maxRetries: 5 });
    await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
  });

  it('starts the built CLI with a node shebang and imports only Node built-ins', async () => {
    const text = await readFile(cli(), 'utf8');

    const imports = [...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]);
    expect(text.split('\n')[0]).toBe('#!/usr/bin/env node');
    expect(imports.length).toBeGreaterThan(0);
    expect(imports.filter((source) => !source?.startsWith('node:'))).toEqual([]);
  });

  it('declares no runtime dependencies', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'));

    expect(manifest).not.toHaveProperty('dependencies');
  });

  it('prints the version from the package.json beside dist/', async () => {
    const manifest = z
      .object({ version: z.string() })
      .parse(JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8')));

    const result = await execa(process.execPath, [cli(), '--version']);

    expect(result.stdout).toBe(manifest.version);
  });

  it('runs skills check on a repository', async () => {
    const result = await execa(process.execPath, [cli(), 'skills', 'check'], { cwd: fixture });

    expect(result.stdout).toBe('Skills mirror is in sync.');
  });

  it('packs only the built CLI, package.json and README.md', async () => {
    const result = await execa('npm', ['pack', '--dry-run', '--json'], { cwd: packageDir });

    const [pack] = PackResult.parse(JSON.parse(result.stdout));
    expect(pack?.files.map((file) => file.path).toSorted()).toEqual([
      'README.md',
      'dist/cli.mjs',
      'package.json',
    ]);
  });
});
