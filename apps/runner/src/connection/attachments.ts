import { writeFile } from 'node:fs/promises';
import { runnerAttachmentPath } from '@plangineer/contracts';

/** A download the control plane refused or the connection lost. */
export class AttachmentDownloadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AttachmentDownloadError';
  }
}

export interface Attachments {
  /** Saves an attachment of the intake run this runner holds to `file`. */
  download(attachmentId: string, file: string, signal: AbortSignal): Promise<void>;
}

/**
 * Downloads attachments from the control plane with the runner token, the one the socket uses.
 * A redirect fails the download, so the token never goes to another origin.
 */
export function createAttachments(options: { serverUrl: string; token: string }): Attachments {
  async function download(attachmentId: string, file: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(new URL(runnerAttachmentPath(attachmentId), options.serverUrl), {
        headers: { authorization: `Bearer ${options.token}` },
        redirect: 'error',
        signal,
      });
    } catch (error) {
      throw new AttachmentDownloadError('the control plane could not be reached', {
        cause: error,
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AttachmentDownloadError(`the control plane answered ${response.status}`);
    }
    let content: ArrayBuffer;
    try {
      // An attachment is at most 10 MiB, so it is read whole.
      content = await response.arrayBuffer();
    } catch (error) {
      throw new AttachmentDownloadError('the download broke off', { cause: error });
    }
    await writeFile(file, new Uint8Array(content));
  }

  return { download };
}
