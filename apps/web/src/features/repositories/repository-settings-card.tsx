import { zodResolver } from '@hookform/resolvers/zod';
import { useUpdateRepository } from '@plangineer/api-client';
import { AgentRole, type RepositoryDetail, type RoleSettings } from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import { type Control, Controller, type FieldPathByValue, useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RunModeField } from '@/features/features/run-mode-field';
import {
  SettingsFields,
  type SettingsInput,
  settingsInput,
  type SettingsOutput,
} from './repository-settings-fields';
import { RepositorySettingsView } from './repository-settings-view';
import { ROLE_LABELS, ROLE_RUNTIME } from './settings-labels';

type SettingsControl = Control<SettingsInput, unknown, SettingsOutput>;
type TextPath = FieldPathByValue<SettingsInput, string>;

function TextField({
  control,
  name,
  label,
  hint,
  multiline = false,
  placeholder,
}: {
  control: SettingsControl;
  name: TextPath;
  label: string;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
}) {
  const id = `settings-${name.replaceAll('.', '-')}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [hint && `${id}-hint`, fieldState.invalid && `${id}-error`]
          .filter(Boolean)
          .join(' ');
        const props = {
          ...field,
          id,
          'aria-invalid': fieldState.invalid,
          'aria-describedby': describedBy === '' ? undefined : describedBy,
        };
        return (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {hint !== undefined && (
              <p id={`${id}-hint`} className="text-muted-foreground">
                {hint}
              </p>
            )}
            {multiline ? (
              <Textarea {...props} rows={3} maxLength={200} />
            ) : (
              <Input {...props} placeholder={placeholder} className="font-mono" />
            )}
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

function roleSettingsWithModels(
  current: RoleSettings,
  models: SettingsOutput['models'],
): RoleSettings {
  return {
    pre_planning: { ...current.pre_planning, model: models.pre_planning },
    planning: { ...current.planning, model: models.planning },
    plan_review: { ...current.plan_review, model: models.plan_review },
    implementation: { ...current.implementation, model: models.implementation },
    implementation_review: {
      ...current.implementation_review,
      model: models.implementation_review,
    },
    verification: { ...current.verification, model: models.verification },
  };
}

function SettingsForm({ repository }: { repository: RepositoryDetail }) {
  const update = useUpdateRepository();
  const form = useForm<SettingsInput, unknown, SettingsOutput>({
    resolver: zodResolver(SettingsFields),
    defaultValues: settingsInput(repository),
  });
  const submit = form.handleSubmit(({ description, models, defaultRunMode }) =>
    update.mutate({
      repositoryId: repository.id,
      description,
      roleSettings: roleSettingsWithModels(repository.roleSettings, models),
      defaultRunMode,
    }),
  );

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-4">
        <TextField control={form.control} name="description" label="Description" multiline />
        <fieldset className="flex min-w-0 flex-col gap-3">
          <legend className="mb-1 text-sm font-medium">Agents</legend>
          {AgentRole.options.map((role) => (
            <TextField
              key={role}
              control={form.control}
              name={`models.${role}`}
              label={`${ROLE_LABELS[role]} model`}
              hint={ROLE_RUNTIME}
              placeholder="Default model"
            />
          ))}
        </fieldset>
        <Controller
          control={form.control}
          name="defaultRunMode"
          render={({ field }) => (
            <RunModeField
              id="settings-default-run-mode"
              label="Default run mode"
              value={field.value}
              onValueChange={field.onChange}
              triggerRef={field.ref}
              onBlur={field.onBlur}
            />
          )}
        />
      </FieldGroup>
      <Button type="submit" className="w-full md:w-auto md:self-start" disabled={update.isPending}>
        {update.isPending ? 'Saving…' : 'Save'}
      </Button>
      {update.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            The settings could not be saved: {update.error.message}
          </AlertDescription>
        </Alert>
      )}
    </form>
  );
}

/** The repository's description, agent models and default run mode. Only admins edit them. */
export function RepositorySettingsCard({
  repository,
  isAdmin,
}: {
  repository: RepositoryDetail;
  isAdmin: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Settings</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <SettingsForm repository={repository} />
        ) : (
          <RepositorySettingsView repository={repository} />
        )}
      </CardContent>
    </Card>
  );
}
