import { zodResolver } from '@hookform/resolvers/zod';
import { useUpdateRepository } from '@plangineer/api-client';
import { AgentRole, type RepositoryDetail, type RoleSettings } from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import {
  type Control,
  Controller,
  type FieldPathByValue,
  useForm,
  useWatch,
} from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  SettingsFields,
  type SettingsInput,
  settingsInput,
  type SettingsOutput,
} from './repository-settings-fields';
import { RepositorySettingsView } from './repository-settings-view';
import {
  FINDINGS_LABELS,
  PLAN_CHECK_IN_LABELS,
  REVIEWS,
  ROLE_LABELS,
  ROLE_RUNTIME,
  ROUNDS_LABELS,
} from './settings-labels';

type SettingsControl = Control<SettingsInput, unknown, SettingsOutput>;
type TextPath = FieldPathByValue<SettingsInput, string>;

function SelectField({
  control,
  name,
  label,
  labels,
}: {
  control: SettingsControl;
  name: TextPath;
  label: string;
  labels: Record<string, string>;
}) {
  const id = `settings-${name.replaceAll('.', '-')}`;
  const items = Object.entries(labels).map(([value, itemLabel]) => ({ value, label: itemLabel }));
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldTitle id={`${id}-label`}>{label}</FieldTitle>
          <Select
            items={items}
            value={field.value}
            onValueChange={(value) => field.onChange(value)}
          >
            <SelectTrigger ref={field.ref} className="w-full" aria-labelledby={`${id}-label`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
    />
  );
}

function TextField({
  control,
  name,
  label,
  hint,
  multiline = false,
  ...inputProps
}: {
  control: SettingsControl;
  name: TextPath;
  label: string;
  hint?: string;
  multiline?: boolean;
} & Pick<React.ComponentProps<'input'>, 'placeholder' | 'type' | 'inputMode' | 'min' | 'max'>) {
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
              <Input {...props} {...inputProps} className="font-mono" />
            )}
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

function ReviewGroup({
  control,
  review,
  title,
}: {
  control: SettingsControl;
  review: (typeof REVIEWS)[number]['key'];
  title: string;
}) {
  const mode = useWatch({ control, name: `workflowSettings.${review}.roundsMode` });
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-1 text-sm font-medium">{title}</legend>
      <SelectField
        control={control}
        name={`workflowSettings.${review}.findings`}
        label="Findings"
        labels={FINDINGS_LABELS}
      />
      <SelectField
        control={control}
        name={`workflowSettings.${review}.roundsMode`}
        label="Rounds"
        labels={ROUNDS_LABELS}
      />
      {mode !== 'ask' && (
        <TextField
          control={control}
          name={`workflowSettings.${review}.roundCount`}
          label={mode === 'fixed' ? 'Number of rounds' : 'Most rounds'}
          type="number"
          inputMode="numeric"
          min={1}
          max={5}
        />
      )}
    </fieldset>
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
  const submit = form.handleSubmit(({ description, models, workflowSettings }) =>
    update.mutate({
      repositoryId: repository.id,
      description,
      roleSettings: roleSettingsWithModels(repository.roleSettings, models),
      workflowSettings,
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
        <fieldset className="flex min-w-0 flex-col gap-4">
          <legend className="mb-1 text-sm font-medium">Workflow</legend>
          <SelectField
            control={form.control}
            name="workflowSettings.planCheckIn"
            label="Plan check-in"
            labels={PLAN_CHECK_IN_LABELS}
          />
          {REVIEWS.map(({ key, title }) => (
            <ReviewGroup key={key} control={form.control} review={key} title={title} />
          ))}
        </fieldset>
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

/** The repository's description, agent models and workflow settings. Only admins edit them. */
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
