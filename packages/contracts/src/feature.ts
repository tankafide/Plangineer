import { z } from 'zod';
import { base } from './base.ts';
import { ContextFileSummary } from './context-file.ts';
import { PageInput, pageOutput } from './pagination.ts';
import { CommitSha, RunStatus } from './run.ts';
import { RunMode, WorkflowSettings } from './run-mode.ts';

export const FeatureState = z.enum(['pre_planning', 'plan_ready', 'planning']);
export type FeatureState = z.infer<typeof FeatureState>;

export const PrePlanningTaskKind = z.enum(['intake', 'exploration', 'research']);
export type PrePlanningTaskKind = z.infer<typeof PrePlanningTaskKind>;

/** A link to the engineer's ticket. Nothing fetches it. */
export const TicketUrl = z.url({ protocol: /^https$/ }).max(300);

export const AttachmentMediaType = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/markdown',
]);
export type AttachmentMediaType = z.infer<typeof AttachmentMediaType>;

/** 190 characters keeps the title `Research: <topic>` within the context file title cap. */
export const ResearchTopic = z.string().trim().min(1).max(190);

export const FEATURE_DESCRIPTION_MAX = 50_000;
export const ATTACHMENT_BYTES_MAX = 10 * 1024 * 1024;
export const ATTACHMENTS_TOTAL_BYTES_MAX = 25 * 1024 * 1024;
export const ATTACHMENTS_MAX = 10;
export const ATTACHMENT_NAME_MAX = 200;
export const RESEARCH_TOPICS_MAX = 10;
/** The cap on a task's rendered inputs file. */
export const TASK_INPUTS_MAX = 60_000;

const Attachment = z
  .file()
  .min(1)
  .max(ATTACHMENT_BYTES_MAX)
  .mime(AttachmentMediaType.options)
  .refine(
    (file) => file.name.length >= 1 && file.name.length <= ATTACHMENT_NAME_MAX,
    `must have a name of 1 to ${ATTACHMENT_NAME_MAX} characters`,
  );

export const FeatureCreateInput = z.strictObject({
  description: z.string().trim().min(1).max(FEATURE_DESCRIPTION_MAX),
  ticketUrl: TicketUrl.optional(),
  attachments: z
    .array(Attachment)
    .max(ATTACHMENTS_MAX)
    .refine(
      (files) => files.reduce((total, file) => total + file.size, 0) <= ATTACHMENTS_TOTAL_BYTES_MAX,
      `must total at most ${ATTACHMENTS_TOTAL_BYTES_MAX} bytes`,
    ),
  exploreCodebase: z.boolean(),
  researchTopics: z.array(ResearchTopic).max(RESEARCH_TOPICS_MAX),
  runMode: RunMode,
  /** Shaped for several repositories, limited to one for now. */
  repositoryIds: z.array(z.uuid()).length(1),
});
export type FeatureCreateInput = z.input<typeof FeatureCreateInput>;

export const FeatureRepository = z.object({ id: z.uuid(), owner: z.string(), name: z.string() });
export type FeatureRepository = z.infer<typeof FeatureRepository>;

export const FeatureAttachment = z.object({
  id: z.uuid(),
  name: z.string(),
  mediaType: AttachmentMediaType,
  sizeBytes: z.int(),
});
export type FeatureAttachment = z.infer<typeof FeatureAttachment>;

export const PrePlanningTask = z.object({
  id: z.uuid(),
  kind: PrePlanningTaskKind,
  repository: FeatureRepository,
  topic: z.string().nullable(),
  runId: z.uuid(),
  status: RunStatus,
  commit: CommitSha.nullable(),
});
export type PrePlanningTask = z.infer<typeof PrePlanningTask>;

/** One intake, one exploration and up to ten research tasks. */
const TASKS_MAX = 2 + RESEARCH_TOPICS_MAX;

export const FeatureSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  state: FeatureState,
  runMode: RunMode,
  createdAt: z.iso.datetime(),
});
export type FeatureSummary = z.infer<typeof FeatureSummary>;

export const FeatureDetail = FeatureSummary.extend({
  description: z.string(),
  ticketUrl: z.string().nullable(),
  exploreCodebase: z.boolean(),
  workflowSettings: WorkflowSettings,
  repositories: z.array(FeatureRepository).max(1),
  attachments: z.array(FeatureAttachment).max(ATTACHMENTS_MAX),
  tasks: z.array(PrePlanningTask).max(TASKS_MAX),
  contextFiles: z.array(ContextFileSummary).max(TASKS_MAX),
  updatedAt: z.iso.datetime(),
});
export type FeatureDetail = z.infer<typeof FeatureDetail>;

const FeatureIdInput = z.strictObject({ featureId: z.uuid() });

export const FeatureUpdateInput = z.strictObject({ featureId: z.uuid(), runMode: RunMode });
export type FeatureUpdateInput = z.infer<typeof FeatureUpdateInput>;

export const StartPlanningConflictData = z.object({
  reason: z.enum(['auto_loop', 'already_planning']),
});
export type StartPlanningConflictData = z.infer<typeof StartPlanningConflictData>;

const NotFound = { status: 404 };

export const featureCreate = base
  .errors({ NOT_FOUND: NotFound, RUNNER_REQUIRED: { status: 409 } })
  .input(FeatureCreateInput)
  .output(FeatureDetail);

export const featureList = base.input(PageInput).output(pageOutput(FeatureSummary));

export const featureGet = base
  .errors({ NOT_FOUND: NotFound })
  .input(FeatureIdInput)
  .output(FeatureDetail);

export const featureUpdate = base
  .errors({ NOT_FOUND: NotFound })
  .input(FeatureUpdateInput)
  .output(FeatureDetail);

export const featureStartPlanning = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: { status: 409, data: StartPlanningConflictData } })
  .input(FeatureIdInput)
  .output(FeatureDetail);
