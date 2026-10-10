import { z } from 'zod';
import { base } from './base.ts';
import { AGENT_TEXT_MAX } from './run-event.ts';

/** A context file holds an agent's whole answer, so its cap is the agent text cap. */
export const CONTEXT_FILE_CONTENT_MAX = AGENT_TEXT_MAX;
export const CONTEXT_FILE_TITLE_MAX = 200;

export const ContextFileSummary = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  title: z.string(),
  ticked: z.boolean(),
  updatedAt: z.iso.datetime(),
});
export type ContextFileSummary = z.infer<typeof ContextFileSummary>;

export const ContextFile = ContextFileSummary.extend({ featureId: z.uuid(), content: z.string() });
export type ContextFile = z.infer<typeof ContextFile>;

export const ContextFileUpdateInput = z
  .strictObject({
    contextFileId: z.uuid(),
    title: z.string().trim().min(1).max(CONTEXT_FILE_TITLE_MAX).optional(),
    content: z.string().min(1).max(CONTEXT_FILE_CONTENT_MAX).optional(),
    ticked: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined || input.content !== undefined || input.ticked !== undefined,
    'must change at least one field',
  );
export type ContextFileUpdateInput = z.infer<typeof ContextFileUpdateInput>;

const ContextFileIdInput = z.strictObject({ contextFileId: z.uuid() });

const NotFound = { status: 404 };

export const contextFileGet = base
  .errors({ NOT_FOUND: NotFound })
  .input(ContextFileIdInput)
  .output(ContextFile);

export const contextFileUpdate = base
  .errors({ NOT_FOUND: NotFound })
  .input(ContextFileUpdateInput)
  .output(ContextFile);

export const contextFileDelete = base
  .errors({ NOT_FOUND: NotFound })
  .input(ContextFileIdInput)
  .output(z.object({ id: z.uuid() }));
