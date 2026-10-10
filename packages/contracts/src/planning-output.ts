import { z } from 'zod';
import { jsonByteLength } from './json-bytes.ts';
import {
  DraftConstraint,
  DraftCoverageRow,
  DraftDecision,
  DraftPrerequisite,
  DraftStep,
  PLAN_DECISIONS_MAX,
  PlanDraft,
  PlanSection,
  PlanTitle,
  PlanVerification,
} from './plan-body.ts';

export const PlanningTurnKind = z.enum(['guided', 'section_action', 'revise_step']);
export type PlanningTurnKind = z.infer<typeof PlanningTurnKind>;

/** The cap on one planning output serialized as JSON, so its event fits a runner message. */
export const PLANNING_OUTPUT_MAX_BYTES = 256 * 1024;
export const QUESTIONS_PER_TURN_MAX = 5;

/** A question's fields, shared by the agent's draft and the stored question. */
export const QuestionFields = {
  section: PlanSection,
  prompt: z.string().trim().min(1).max(2_000),
  choices: z
    .array(z.strictObject({ label: PlanTitle, detail: z.string().max(1_000) }))
    .min(2)
    .max(4),
  recommended: z.int().min(0).max(3),
};

export const QuestionDraft = z
  .strictObject(QuestionFields)
  .refine((question) => question.recommended < question.choices.length, {
    message: 'must index one of the choices',
    path: ['recommended'],
  });
export type QuestionDraft = z.infer<typeof QuestionDraft>;

/** One section's new value, as a section action writes it. */
export const SectionPatch = z.discriminatedUnion('section', [
  z.strictObject({ section: z.literal('goal'), goal: z.string().trim().min(1).max(4_000) }),
  z.strictObject({
    section: z.literal('prerequisites'),
    prerequisites: z.array(DraftPrerequisite).max(20),
  }),
  z.strictObject({ section: z.literal('steps'), steps: z.array(DraftStep).min(1).max(60) }),
  z.strictObject({
    section: z.literal('decisions'),
    decisions: z.array(DraftDecision).max(PLAN_DECISIONS_MAX),
  }),
  z.strictObject({
    section: z.literal('constraints'),
    constraints: z.array(DraftConstraint).max(20),
  }),
  z.strictObject({ section: z.literal('test_plan'), coverage: z.array(DraftCoverageRow).max(800) }),
  z.strictObject({ section: z.literal('verification'), verification: PlanVerification }),
]);
export type SectionPatch = z.infer<typeof SectionPatch>;

/** What one planning run writes to `.plangineer-task/output.json`. */
export const PlanningOutput = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('questions'),
      questions: z.array(QuestionDraft).min(1).max(QUESTIONS_PER_TURN_MAX),
      decisions: z.array(DraftDecision).max(PLAN_DECISIONS_MAX),
    }),
    z.strictObject({ kind: z.literal('plan'), plan: PlanDraft }),
    z.strictObject({ kind: z.literal('section'), patch: SectionPatch }),
    z.strictObject({ kind: z.literal('step'), step: DraftStep }),
  ])
  .refine(
    (output) => jsonByteLength(output) <= PLANNING_OUTPUT_MAX_BYTES,
    `must serialize to at most ${PLANNING_OUTPUT_MAX_BYTES} bytes`,
  );
export type PlanningOutput = z.infer<typeof PlanningOutput>;
