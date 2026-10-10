import type { Context } from 'hono';
import { z } from 'zod';
import { getAttachmentForRunner } from '../features/feature-service.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { authenticateRunner } from './runner-auth.ts';

const AttachmentId = z.uuid();

/**
 * Serves an attachment's bytes to the runner holding a leased or running intake run of its
 * feature. A bad token answers 401, and every other refusal answers 404, so a runner learns
 * nothing about attachments it may not read.
 */
export function runnerAttachmentRoute(deps: ServiceDeps) {
  return async (c: Context) => {
    const runner = await authenticateRunner(deps.db, c.req.header('authorization'));
    if (runner === undefined) return c.text('Unauthorized', 401);
    const attachmentId = AttachmentId.safeParse(c.req.param('attachmentId'));
    const attachment = attachmentId.success
      ? await getAttachmentForRunner(deps, runner.id, attachmentId.data)
      : undefined;
    if (attachment === undefined) return c.text('Not Found', 404);
    return c.body(new Uint8Array(attachment.content), 200, {
      'content-type': attachment.mediaType,
      'cache-control': 'no-store',
    });
  };
}
