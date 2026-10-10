import { z } from 'zod';
import { base } from './base.ts';
import { FeatureState } from './feature.ts';
import { PageInput, pageOutput } from './pagination.ts';
import {
  PLAN_DECISIONS_MAX,
  PlanBody,
  PlanDecision,
  PlanSection,
  SectionAction,
} from './plan-body.ts';
import { PlanningTurnKind, QUESTIONS_PER_TURN_MAX, QuestionFields } from './planning-output.ts';
import { CommitSha, RunStatus } from './run.ts';
import { RunMode, WorkflowSettings } from './run-mode.ts';

/** The cap on a planning turn's rendered inputs file. */
export const PLANNING_INPUTS_MAX = 2_000_000;
/** How many of the latest answered questions a turn's inputs carry. */
export const PLAN_QUESTIONS_IN_INPUTS = 40;

export const ReadinessKey = z.enum([
  'open_questions',
  'step_files',
  'done_when',
  'coverage',
  'stale_rows',
  'blockers',
]);
export type ReadinessKey = z.infer<typeof ReadinessKey>;

export const ReadinessItem = z.object({
  key: ReadinessKey,
  ok: z.boolean(),
  count: z.int().min(0),
});
export type ReadinessItem = z.infer<typeof ReadinessItem>;

export const SectionStatus = z.enum(['complete', 'open_question', 'needs_work']);
export type SectionStatus = z.infer<typeof SectionStatus>;

export const PlanQuestion = z.object({
  id: z.uuid(),
  ...QuestionFields,
  answerChoice: z.int().nullable(),
  answerText: z.string().nullable(),
  answeredAt: z.iso.datetime().nullable(),
});
export type PlanQuestion = z.infer<typeof PlanQuestion>;

export const PlanningTurn = z.object({
  id: z.uuid(),
  kind: PlanningTurnKind,
  section: PlanSection.nullable(),
  action: SectionAction.nullable(),
  stepId: z.uuid().nullable(),
  runId: z.uuid(),
  status: RunStatus,
  createdAt: z.iso.datetime(),
});
export type PlanningTurn = z.infer<typeof PlanningTurn>;

/** A done-when line with its label, such as `2a`. */
export const AcceptanceCriterion = z.object({
  lineId: z.uuid(),
  label: z.string(),
  text: z.string(),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const PlanRevisionSource = z.enum(['agent', 'engineer']);
export type PlanRevisionSource = z.infer<typeof PlanRevisionSource>;

export const PlanRevisionSummary = z.object({
  id: z.uuid(),
  number: z.int().min(1),
  source: PlanRevisionSource,
  createdAt: z.iso.datetime(),
});
export type PlanRevisionSummary = z.infer<typeof PlanRevisionSummary>;

export const PlanRevision = PlanRevisionSummary.extend({
  body: PlanBody,
  acceptanceCriteria: z.array(AcceptanceCriterion).max(800),
  contextFiles: z.array(z.object({ id: z.uuid(), title: z.string() })).max(12),
  /** Shaped for several repositories, limited to one for now. */
  baseCommits: z.array(z.object({ repositoryId: z.uuid(), commit: CommitSha })).max(1),
});
export type PlanRevision = z.infer<typeof PlanRevision>;

export const PlanWorkspace = z.object({
  featureId: z.uuid(),
  featureState: FeatureState,
  runMode: RunMode,
  workflowSettings: WorkflowSettings,
  revision: PlanRevision.nullable(),
  turn: PlanningTurn.nullable(),
  questions: z.array(PlanQuestion).max(QUESTIONS_PER_TURN_MAX),
  decisions: z.array(PlanDecision).max(PLAN_DECISIONS_MAX),
  readiness: z.array(ReadinessItem).max(ReadinessKey.options.length),
  sections: z
    .array(z.object({ section: PlanSection, status: SectionStatus }))
    .max(PlanSection.options.length),
  autoLoopStopped: z.boolean(),
});
export type PlanWorkspace = z.infer<typeof PlanWorkspace>;

/** Why a plan write was refused. A turn runs while its run is queued, leased or running. */
export const PlanConflictReason = z.enum([
  'not_planning',
  'turn_running',
  'questions_open',
  'stale_revision',
  'not_ready',
  'answered',
  'question_closed',
  'nothing_to_retry',
]);
export type PlanConflictReason = z.infer<typeof PlanConflictReason>;

export const PlanConflictData = z.object({ reason: PlanConflictReason });
export type PlanConflictData = z.infer<typeof PlanConflictData>;

const FeatureIdInput = z.strictObject({ featureId: z.uuid() });
const RevisionNumber = z.int().min(1);

/** An answer is one of the question's choices, by index, or the engineer's own text. */
export const PlanAnswerInput = z
  .strictObject({
    questionId: z.uuid(),
    choice: z.int().min(0).max(3).optional(),
    text: z.string().trim().min(1).max(4_000).optional(),
  })
  .refine(
    (input) => (input.choice === undefined) !== (input.text === undefined),
    'must hold exactly one of choice and text',
  );
export type PlanAnswerInput = z.infer<typeof PlanAnswerInput>;

export const PlanEditInput = z.strictObject({
  featureId: z.uuid(),
  revision: RevisionNumber,
  body: PlanBody,
});
export type PlanEditInput = z.infer<typeof PlanEditInput>;

export const PlanSectionActionInput = z.strictObject({
  featureId: z.uuid(),
  revision: RevisionNumber,
  section: PlanSection,
  action: SectionAction,
});
export type PlanSectionActionInput = z.infer<typeof PlanSectionActionInput>;

export const PlanReviseStepInput = z.strictObject({
  featureId: z.uuid(),
  revision: RevisionNumber,
  stepId: z.uuid(),
  instruction: z.string().trim().min(1).max(2_000),
});
export type PlanReviseStepInput = z.infer<typeof PlanReviseStepInput>;

const PlanMarkReadyInput = z.strictObject({ featureId: z.uuid(), revision: RevisionNumber });

const PlanRevisionsInput = PageInput.extend({ featureId: z.uuid() });

const PlanRevisionInput = z.strictObject({ featureId: z.uuid(), number: RevisionNumber });

const NotFound = { status: 404 };
const Conflict = { status: 409, data: PlanConflictData };
const RunnerRequired = { status: 409 };

export const planGet = base
  .errors({ NOT_FOUND: NotFound })
  .input(FeatureIdInput)
  .output(PlanWorkspace);

export const planAnswer = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, RUNNER_REQUIRED: RunnerRequired })
  .input(PlanAnswerInput)
  .output(PlanWorkspace);

export const planContinue = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, RUNNER_REQUIRED: RunnerRequired })
  .input(FeatureIdInput)
  .output(PlanWorkspace);

export const planRetry = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, RUNNER_REQUIRED: RunnerRequired })
  .input(FeatureIdInput)
  .output(PlanWorkspace);

export const planEdit = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict })
  .input(PlanEditInput)
  .output(PlanWorkspace);

export const planSectionAction = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, RUNNER_REQUIRED: RunnerRequired })
  .input(PlanSectionActionInput)
  .output(PlanWorkspace);

export const planReviseStep = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, RUNNER_REQUIRED: RunnerRequired })
  .input(PlanReviseStepInput)
  .output(PlanWorkspace);

export const planMarkReady = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict })
  .input(PlanMarkReadyInput)
  .output(PlanWorkspace);

export const planRevisions = base
  .errors({ NOT_FOUND: NotFound })
  .input(PlanRevisionsInput)
  .output(pageOutput(PlanRevisionSummary));

export const planRevision = base
  .errors({ NOT_FOUND: NotFound })
  .input(PlanRevisionInput)
  .output(PlanRevision);
