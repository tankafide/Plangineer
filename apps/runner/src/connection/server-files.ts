import { writeFile } from 'node:fs/promises';
import { runnerAttachmentPath, runnerPlanningInputsPath } from '@plangineer/contracts';

/** A download the control plane refused or the connection lost. */
export class ServerFileError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ServerFileError';
  }
}

/** The files a run downloads from the control plane, each saved to `destination`. */
export interface ServerFiles {
  /** An attachment of the intake run this runner holds. */
  attachment(attachmentId: string, destination: string, signal: AbortSignal): Promise<void>;
  /** The inputs of the planning run this runner holds. */
  planningInputs(runId: string, destination: string, signal: AbortSignal): Promise<void>;
}

/**
 * Downloads run files from the control plane with the runner token, the one the socket uses.
 * A redirect fails the download, so the token never goes to another origin.
 */
export function createServerFiles(options: { serverUrl: string; token: string }): ServerFiles {
  async function download(pathname: string, destination: string, signal: AbortSignal) {
    let response: Response;
    try {
      response = await fetch(new URL(pathname, options.serverUrl), {
        headers: { authorization: `Bearer ${options.token}` },
        redirect: 'error',
        signal,
      });
    } catch (error) {
      throw new ServerFileError('the control plane could not be reached', { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ServerFileError(`the control plane answered ${response.status}`);
    }
    let content: ArrayBuffer;
    try {
      // An attachment is at most 10 MiB and planning inputs 2,000,000 characters, so each is read whole.
      content = await response.arrayBuffer();
    } catch (error) {
      throw new ServerFileError('the download broke off', { cause: error });
    }
    await writeFile(destination, new Uint8Array(content));
  }

  return {
    attachment: (attachmentId, destination, signal) =>
      download(runnerAttachmentPath(attachmentId), destination, signal),
    planningInputs: (runId, destination, signal) =>
      download(runnerPlanningInputsPath(runId), destination, signal),
  };
}
