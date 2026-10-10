import { z } from 'zod';
import { jsonByteLength } from './json-bytes.ts';

export const PlanSection = z.enum([
  'goal',
  'prerequisites',
  'steps',
  'decisions',
  'constraints',
  'test_plan',
  'verification',
]);
export type PlanSection = z.infer<typeof PlanSection>;

export const SectionAction = z.enum(['expand', 'simplify', 'regenerate']);
export type SectionAction = z.infer<typeof SectionAction>;

export const CoverageColumn = z.enum([
  'unit',
  'integration',
  'component',
  'end_to_end',
  'agent_check',
  'human_check',
]);
export type CoverageColumn = z.infer<typeof CoverageColumn>;

const PlanLine = z.string().trim().min(1).max(2_000);
export const PlanTitle = z.string().trim().min(1).max(200);

/** The cap on a plan body serialized as JSON, stored or drafted. */
export const PLAN_BODY_MAX_BYTES = 256 * 1024;
export const PLAN_DECISIONS_MAX = 100;
export const DONE_WHEN_MAX = 12;

/** An agent names a new item freely, such as `new-1`. The app swaps it for a uuid. */
const DraftId = z.string().min(1).max(64);

const Ticks = z
  .array(CoverageColumn)
  .max(CoverageColumn.options.length)
  .refine((ticks) => new Set(ticks).size === ticks.length, 'must not repeat a column');

const PlanVerification = z.strictObject({
  automated: z.array(PlanLine).max(30),
  agentChecks: z.array(PlanLine).max(30),
  humanChecks: z.array(PlanLine).max(30),
});

/** The references a body's checks follow, shared by the stored body and the draft. */
interface BodyReferences {
  prerequisites: { id: string }[];
  steps: { id: string; doneWhen: { id: string }[] }[];
  decisions: { id: string }[];
  constraints: { id: string }[];
  coverage: { lineId: string }[];
  blockers: { id: string; stepId: string | null }[];
}

function checkReferences(body: BodyReferences, ctx: z.RefinementCtx) {
  const ids = [
    ...body.prerequisites.map((item) => item.id),
    ...body.steps.flatMap((step) => [step.id, ...step.doneWhen.map((line) => line.id)]),
    ...body.decisions.map((item) => item.id),
    ...body.constraints.map((item) => item.id),
    ...body.blockers.map((item) => item.id),
  ];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) ctx.addIssue({ code: 'custom', message: `repeats the id ${id}`, path: [] });
    seen.add(id);
  }

  const lineIds = new Set([
    ...body.steps.flatMap((step) => step.doneWhen.map((line) => line.id)),
    ...body.constraints.map((item) => item.id),
  ]);
  body.coverage.forEach((row, index) => {
    if (!lineIds.has(row.lineId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'must name a done-when line or constraint',
        path: ['coverage', index, 'lineId'],
      });
    }
  });

  const stepIds = new Set(body.steps.map((step) => step.id));
  body.blockers.forEach((blocker, index) => {
    if (blocker.stepId !== null && !stepIds.has(blocker.stepId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'must name a step',
        path: ['blockers', index, 'stepId'],
      });
    }
  });
}

/** The plan's item schemas around one id schema, so stored bodies and drafts share them. */
function planShapes(id: z.ZodType<string, string>) {
  const Prerequisite = z.strictObject({
    id,
    item: PlanLine,
    who: PlanTitle,
    status: z.enum(['open', 'resolved']),
  });
  const DoneWhen = z.strictObject({ id, text: PlanLine });
  const Step = z.strictObject({
    id,
    title: PlanTitle,
    files: z.array(z.string().trim().min(1).max(300)).max(40),
    body: z.string().max(20_000),
    doneWhen: z.array(DoneWhen).max(DONE_WHEN_MAX),
  });
  const Decision = z.strictObject({
    id,
    title: PlanTitle,
    reason: z.string().trim().min(1).max(4_000),
    by: z.enum(['agent', 'engineer']),
  });
  const Constraint = z.strictObject({ id, title: PlanTitle, target: PlanLine, check: PlanLine });
  const CoverageRow = z.strictObject({ lineId: id, ticks: Ticks });
  const Blocker = z.strictObject({
    id,
    section: PlanSection,
    stepId: id.nullable(),
    text: PlanLine,
  });

  function body<
    S extends z.ZodType<BodyReferences['steps'][number]>,
    R extends z.ZodType<{ lineId: string }>,
  >(step: S, coverageRow: R) {
    return z
      .strictObject({
        goal: z.string().trim().min(1).max(4_000),
        prerequisites: z.array(Prerequisite).max(20),
        steps: z.array(step).min(1).max(60),
        decisions: z.array(Decision).max(PLAN_DECISIONS_MAX),
        constraints: z.array(Constraint).max(20),
        coverage: z.array(coverageRow).max(800),
        blockers: z.array(Blocker).max(50),
        verification: PlanVerification,
      })
      .superRefine(checkReferences)
      .refine(
        (value) => jsonByteLength(value) <= PLAN_BODY_MAX_BYTES,
        `must serialize to at most ${PLAN_BODY_MAX_BYTES} bytes`,
      );
  }

  return { Prerequisite, Step, Decision, Constraint, CoverageRow, Blocker, body };
}

const stored = planShapes(z.uuid());
const draft = planShapes(DraftId);

export const Prerequisite = stored.Prerequisite;
export type Prerequisite = z.infer<typeof Prerequisite>;
export const PlanStep = stored.Step.extend({ repositoryId: z.uuid() });
export type PlanStep = z.infer<typeof PlanStep>;
export const PlanDecision = stored.Decision;
export type PlanDecision = z.infer<typeof PlanDecision>;
export const PlanConstraint = stored.Constraint;
export type PlanConstraint = z.infer<typeof PlanConstraint>;
export const CoverageRow = stored.CoverageRow.extend({ stale: z.boolean() });
export type CoverageRow = z.infer<typeof CoverageRow>;
export const PlanBlocker = stored.Blocker;
export type PlanBlocker = z.infer<typeof PlanBlocker>;
export { PlanVerification };
export type PlanVerification = z.infer<typeof PlanVerification>;

/** A stored revision's body, and the body an engineer's edit sends. */
export const PlanBody = stored.body(PlanStep, CoverageRow);
export type PlanBody = z.infer<typeof PlanBody>;

export const DraftPrerequisite = draft.Prerequisite;
export type DraftPrerequisite = z.infer<typeof DraftPrerequisite>;
export const DraftStep = draft.Step;
export type DraftStep = z.infer<typeof DraftStep>;
export const DraftDecision = draft.Decision;
export type DraftDecision = z.infer<typeof DraftDecision>;
export const DraftConstraint = draft.Constraint;
export type DraftConstraint = z.infer<typeof DraftConstraint>;
export const DraftCoverageRow = draft.CoverageRow;
export type DraftCoverageRow = z.infer<typeof DraftCoverageRow>;

/** A whole plan as an agent writes it, before the app adopts its ids. */
export const PlanDraft = draft.body(DraftStep, DraftCoverageRow);
export type PlanDraft = z.infer<typeof PlanDraft>;
