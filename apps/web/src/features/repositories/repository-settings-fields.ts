import {
  AgentRole,
  RepositoryAddInput,
  type RepositoryDetail,
  RoleSetting,
  RunMode,
} from '@plangineer/contracts';
import { z } from 'zod';

/** A model name, or empty for the CLI's default model, which saves as null. */
const ModelField = z
  .string()
  .trim()
  .refine(
    (model) => model === '' || RoleSetting.shape.model.safeParse(model).success,
    'Enter a model name of letters, digits, dots, hyphens, underscores or brackets.',
  )
  .transform((model) => (model === '' ? null : model));

/** The settings card's form. Its output holds the contract's description and default run mode. */
export const SettingsFields = z
  .object({
    description: z.string().trim().min(1, 'Describe the repository.'),
    models: z.record(AgentRole, ModelField),
    defaultRunMode: RunMode,
  })
  .pipe(
    z.object({
      description: RepositoryAddInput.shape.description,
      models: z.record(AgentRole, RoleSetting.shape.model),
      defaultRunMode: RunMode,
    }),
  );
export type SettingsInput = z.input<typeof SettingsFields>;
export type SettingsOutput = z.output<typeof SettingsFields>;

/** The form's values for a repository's saved settings. */
export function settingsInput(repository: RepositoryDetail): SettingsInput {
  const { roleSettings } = repository;
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
    defaultRunMode: repository.defaultRunMode,
  };
}
