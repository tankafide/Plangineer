import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stageDesktop } from './build-desktop.mjs';

const TASK_PROMPTS = ['exploration-prompt.md', 'intake-prompt.md', 'research-prompt.md'];

/** Writes one file at a POSIX-style path under root. */
async function put(root, posixPath, text) {
  const file = path.join(root, ...posixPath.split('/'));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text);
}

/** A repository with every built output and asset the stage copies. */
async function builtRepository(root) {
  await put(root, 'apps/api/dist/main.mjs', 'api');
  await put(root, 'apps/api/dist/migrate.mjs', 'migrate');
  await put(root, 'apps/api/dist/chunk-a.mjs', 'chunk');
  await put(root, 'apps/api/drizzle/0000_init.sql', 'sql');
  await put(root, 'apps/api/src/setup/templates/AGENTS.md', 'template');
  for (const prompt of TASK_PROMPTS) {
    await put(root, `apps/api/src/features/templates/${prompt}`, prompt);
  }
  await put(root, '.env.example', 'API_PORT=3000\n');
  await put(root, 'apps/web/dist/index.html', '<html></html>');
  await put(root, 'apps/runner/dist/cli.mjs', 'runner');
  await put(root, 'apps/runner/package.json', '{"version":"0.3.0"}');
}

const read = (root, posixPath) => readFile(path.join(root, ...posixPath.split('/')), 'utf8');

describe('stageDesktop', () => {
  let root;
  let stage;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'build-desktop-'));
    stage = path.join(root, 'apps', 'desktop', 'stage');
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('lays out the stage as the desktop app reads it', async () => {
    await builtRepository(root);

    await stageDesktop(root, stage);

    expect(await read(stage, 'server/dist/main.mjs')).toBe('api');
    expect(await read(stage, 'server/dist/migrate.mjs')).toBe('migrate');
    expect(await read(stage, 'server/dist/chunk-a.mjs')).toBe('chunk');
    expect(await read(stage, 'server/drizzle/0000_init.sql')).toBe('sql');
    expect(await read(stage, 'server/src/setup/templates/AGENTS.md')).toBe('template');
    expect(
      (await readdir(path.join(stage, 'server', 'src', 'features', 'templates'))).toSorted(),
    ).toEqual(TASK_PROMPTS);
    expect(await read(stage, 'server/env.example')).toBe('API_PORT=3000\n');
    expect(await read(stage, 'web/index.html')).toBe('<html></html>');
    expect(await read(stage, 'runner/dist/cli.mjs')).toBe('runner');
    expect(await read(stage, 'runner/package.json')).toBe('{"version":"0.3.0"}');
  });

  it('keeps the fetched Postgres and replaces stale files', async () => {
    await builtRepository(root);
    await put(stage, 'postgres/bin/initdb', 'initdb');
    await put(stage, 'server/dist/stale.mjs', 'old');

    await stageDesktop(root, stage);

    expect(await read(stage, 'postgres/bin/initdb')).toBe('initdb');
    expect((await readdir(path.join(stage, 'server', 'dist'))).toSorted()).toEqual([
      'chunk-a.mjs',
      'main.mjs',
      'migrate.mjs',
    ]);
  });

  it('fails naming the first missing source path, staging nothing', async () => {
    await builtRepository(root);
    await rm(path.join(root, 'apps', 'web', 'dist'), { recursive: true });

    await expect(stageDesktop(root, stage)).rejects.toThrow(
      'apps/web/dist is missing. Run pnpm build first.',
    );
    await expect(readdir(stage)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
