import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FakeControlPlane, startFakeControlPlane } from '../test/fake-control-plane.ts';
import { AttachmentDownloadError, createAttachments } from './attachments.ts';

describe('createAttachments', () => {
  let plane: FakeControlPlane;
  let folder: string;
  const signal = new AbortController().signal;

  beforeEach(async () => {
    plane = await startFakeControlPlane();
    folder = await mkdtemp(path.join(os.tmpdir(), 'runner-attachments-'));
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

    await createAttachments(plane).download(id, file, signal);

    expect(await readFile(file)).toEqual(content);
  });

  it('fails with the status when the control plane has no such attachment', async () => {
    const download = createAttachments(plane).download(
      randomUUID(),
      path.join(folder, 'x'),
      signal,
    );

    await expect(download).rejects.toThrow(
      new AttachmentDownloadError('the control plane answered 404'),
    );
  });

  it('fails with the status when the token is not the runner token', async () => {
    const attachments = createAttachments({ serverUrl: plane.serverUrl, token: 'wrong' });

    await expect(
      attachments.download(randomUUID(), path.join(folder, 'x'), signal),
    ).rejects.toThrow('the control plane answered 401');
  });
});
