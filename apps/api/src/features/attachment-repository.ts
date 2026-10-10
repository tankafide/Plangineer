import type { AttachmentMediaType, FeatureAttachment } from '@plangineer/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { featureAttachments, prePlanningTasks, runs } from '../db/schema.ts';

export interface NewAttachment {
  name: string;
  mediaType: AttachmentMediaType;
  content: Buffer;
}

export async function insertAttachments(
  tx: Transaction,
  featureId: string,
  attachments: NewAttachment[],
): Promise<FeatureAttachment[]> {
  if (attachments.length === 0) return [];
  return tx
    .insert(featureAttachments)
    .values(
      attachments.map((attachment) => ({
        ...attachment,
        featureId,
        sizeBytes: attachment.content.length,
      })),
    )
    .returning({
      id: featureAttachments.id,
      name: featureAttachments.name,
      mediaType: featureAttachments.mediaType,
      sizeBytes: featureAttachments.sizeBytes,
    });
}

/**
 * An attachment's media type and bytes, when the runner holds a leased or running intake run
 * of the attachment's feature.
 */
export async function findAttachmentForRunner(
  executor: Executor,
  runnerId: string,
  attachmentId: string,
): Promise<{ mediaType: AttachmentMediaType; content: Buffer } | undefined> {
  const [row] = await executor
    .select({ mediaType: featureAttachments.mediaType, content: featureAttachments.content })
    .from(featureAttachments)
    .innerJoin(
      prePlanningTasks,
      and(
        eq(prePlanningTasks.featureId, featureAttachments.featureId),
        eq(prePlanningTasks.kind, 'intake'),
      ),
    )
    .innerJoin(runs, eq(runs.id, prePlanningTasks.runId))
    .where(
      and(
        eq(featureAttachments.id, attachmentId),
        eq(runs.runnerId, runnerId),
        inArray(runs.status, ['leased', 'running']),
      ),
    )
    .limit(1);
  return row;
}
