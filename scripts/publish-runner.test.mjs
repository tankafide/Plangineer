import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishRunner } from './publish-runner.mjs';

describe('publishRunner', () => {
  let root;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'publish-runner-'));
    await execa('git', ['init', '--quiet'], { cwd: root });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('stops before building when the working tree has uncommitted changes', async () => {
    await writeFile(path.join(root, 'notes.md'), 'draft\n');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});

    expect(await publishRunner(root)).toBe(1);
    expect(errors).toHaveBeenCalledWith(
      'The working tree has uncommitted changes. Commit or stash them, then publish.',
    );
    expect(logs).not.toHaveBeenCalled();
  });
});
