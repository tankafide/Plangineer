import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeControlPlane, startFakeControlPlane } from '../test/fake-control-plane.ts';
import { createServerFiles, ServerFileError } from './server-files.ts';

describe('createServerFiles', () => {
  let plane: FakeControlPlane;
  let folder: string;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    plane = await startFakeControlPlane();
    folder = await mkdtemp(path.join(os.tmpdir(), 'runner-server-files-'));
  });

  afterEach(async () => {
    await plane.stop();
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  });

  it('saves the attachment bytes the control plane answers with the runner token', async () => {
    const id = randomUUID();
    const content = Buffer.from([0, 1, 2, 255]);
    plane.attachments.set(id, { mediaType: 'image/png', content });
    const file = path.join(folder, 'shot.png');

    await createServerFiles(plane).attachment(id, file, signal);

    expect(await readFile(file)).toEqual(content);
  });

  it('saves the planning inputs of a run the control plane answers with the runner token', async () => {
    const runId = randomUUID();
    const inputs = '# Planning inputs\n\nÜnïcode survives.\n';
    plane.planningInputs.set(runId, inputs);
    const file = path.join(folder, 'inputs.md');

    await createServerFiles(plane).planningInputs(runId, file, signal);

    expect(await readFile(file, 'utf8')).toBe(inputs);
  });

  it.each([
    ['an attachment', 'attachment'],
    ['planning inputs', 'planningInputs'],
  ] as const)('fails with the status when the control plane has no such %s', async (_, kind) => {
    const download = createServerFiles(plane)[kind](randomUUID(), path.join(folder, 'x'), signal);

    await expect(download).rejects.toThrow(new ServerFileError('the control plane answered 404'));
  });

  it('fails with the status when the token is not the runner token', async () => {
    const files = createServerFiles({ serverUrl: plane.serverUrl, token: 'wrong' });

    await expect(
      files.planningInputs(randomUUID(), path.join(folder, 'x'), signal),
    ).rejects.toThrow('the control plane answered 401');
  });
});
