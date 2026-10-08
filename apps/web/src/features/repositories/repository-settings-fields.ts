import {
  AgentRole,
  RepositoryAddInput,
  type RepositoryDetail,
  type ReviewRounds,
  type ReviewSettings,
  RoleSetting,
  WorkflowSettings,
} from '@plangineer/contracts';
import { z } from 'zod';

const ROUND_COUNT = /^[1-5]$/;

/** A model name, or empty for the CLI's default model, which saves as null. */
const ModelField = z
  .string()
  .trim()
  .refine(
    (model) => model === '' || RoleSetting.shape.model.safeParse(model).success,
    'Enter a model name of letters, digits, dots, hyphens, underscores or brackets.',
  )
  .transform((model) => (model === '' ? null : model));

/** One review's settings as the form holds them: the round count is text beside its mode. */
const ReviewFields = z
  .object({
    findings: z.enum(['ask', 'fix_all']),
    roundsMode: z.enum(['ask', 'fixed', 'adaptive']),
    roundCount: z.string(),
  })
  .superRefine((review, context) => {
    if (review.roundsMode === 'ask' || ROUND_COUNT.test(review.roundCount.trim())) return;
    context.addIssue({
      code: 'custom',
      path: ['roundCount'],
      message: 'Enter a whole number from 1 to 5.',
    });
  })
  .transform((review): ReviewSettings => {
    const { findings, roundsMode } = review;
    const count = Number(review.roundCount);
    switch (roundsMode) {
      case 'ask':
        return { findings, rounds: { mode: 'ask' } };
      case 'fixed':
        return { findings, rounds: { mode: 'fixed', count } };
      case 'adaptive':
        return { findings, rounds: { mode: 'adaptive', max: count } };
      default: {
        const unknownMode: never = roundsMode;
        throw new Error(`Unknown rounds mode ${String(unknownMode)}`);
      }
    }
  });

/** The settings card's form. Its output holds the contract's description and workflow settings. */
export const SettingsFields = z
  .object({
    description: z.string().trim().min(1, 'Describe the repository.'),
    models: z.record(AgentRole, ModelField),
    workflowSettings: z.object({
      planCheckIn: z.enum(['pause', 'skip']),
      planReview: ReviewFields,
      implementationReview: ReviewFields,
    }),
  })
  .pipe(
    z.object({
      description: RepositoryAddInput.shape.description,
      models: z.record(AgentRole, RoleSetting.shape.model),
      workflowSettings: WorkflowSettings,
    }),
  );
export type SettingsInput = z.input<typeof SettingsFields>;
export type SettingsOutput = z.output<typeof SettingsFields>;

function roundCount(rounds: ReviewRounds): string {
  switch (rounds.mode) {
    case 'ask':
      return '1';
    case 'fixed':
      return String(rounds.count);
    case 'adaptive':
      return String(rounds.max);
    default: {
      const unknownRounds: never = rounds;
      throw new Error(`Unknown rounds ${JSON.stringify(unknownRounds)}`);
    }
  }
}

function reviewInput(review: ReviewSettings) {
  return {
    findings: review.findings,
    roundsMode: review.rounds.mode,
    roundCount: roundCount(review.rounds),
  };
}

/** The form's values for a repository's saved settings. */
export function settingsInput(repository: RepositoryDetail): SettingsInput {
  const { workflowSettings, roleSettings } = repository;
  return {
    description: repository.description,
    models: {
      pre_planning: roleSettings.pre_planning.model ?? '',
      planning: roleSettings.planning.model ?? '',
      plan_review: roleSettings.plan_review.model ?? '',
      implementation: roleSettings.implementation.model ?? '',
      implementation_review: roleSettings.implementation_review.model ?? '',
      verification: roleSettings.verification.model ?? '',
    },
    workflowSettings: {
      planCheckIn: workflowSettings.planCheckIn,
      planReview: reviewInput(workflowSettings.planReview),
      implementationReview: reviewInput(workflowSettings.implementationReview),
    },
  };
}
