import { z } from 'zod';

/** How far agents take a feature without the engineer. Each mode is a fixed set of settings. */
export const RunMode = z.enum(['manual', 'manual_plan', 'auto_loop']);
export type RunMode = z.infer<typeof RunMode>;

export const Decisions = z.enum(['ask', 'recommended']);
export type Decisions = z.infer<typeof Decisions>;

const RoundCount = z.int().min(1).max(5);

export const ReviewRounds = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('ask') }),
  z.strictObject({ mode: z.literal('fixed'), count: RoundCount }),
  z.strictObject({ mode: z.literal('adaptive'), max: RoundCount }),
]);
export type ReviewRounds = z.infer<typeof ReviewRounds>;

export const ReviewSettings = z.strictObject({
  findings: z.enum(['ask', 'fix_all']),
  rounds: ReviewRounds,
});
export type ReviewSettings = z.infer<typeof ReviewSettings>;

export const PlanCheckIn = z.enum(['pause', 'skip']);
export type PlanCheckIn = z.infer<typeof PlanCheckIn>;

export const WorkflowSettings = z.strictObject({
  decisions: Decisions,
  planCheckIn: PlanCheckIn,
  planReview: ReviewSettings,
  implementationReview: ReviewSettings,
});
export type WorkflowSettings = z.infer<typeof WorkflowSettings>;
