import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError, useCreateFeature } from '@plangineer/api-client';
import type { RepositorySummary } from '@plangineer/contracts';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { type Control, Controller, useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentsField } from './attachments-field';
import { IntakeFields, type IntakeInput, type IntakeOutput } from './intake-fields';
import { RepositoryField } from './repository-field';
import { RunModeField } from './run-mode-field';
import { RunnerRequiredAlert } from './runner-required-alert';

type IntakeControl = Control<IntakeInput, unknown, IntakeOutput>;

function StartFailed({ error }: { error: Error }) {
  if (isApiError(error, 'RUNNER_REQUIRED'))
    return <RunnerRequiredAlert message="No runner can take this feature." />;
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{`The feature could not be started: ${error.message}`}</AlertDescription>
    </Alert>
  );
}

/** A text field with a label, an optional hint and its error, linked for screen readers. */
function TextField({
  control,
  name,
  label,
  hint,
  rows,
}: {
  control: IntakeControl;
  name: 'description' | 'ticketUrl' | 'researchTopics';
  label: string;
  hint?: string;
  rows?: number;
}) {
  const id = `intake-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const describedBy = [
          hint !== undefined && `${id}-hint`,
          fieldState.invalid && `${id}-error`,
        ]
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
            {rows === undefined ? (
              <Input
                {...props}
                type="url"
                inputMode="url"
                placeholder="https://"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            ) : (
              <Textarea {...props} rows={rows} />
            )}
            <FieldError id={`${id}-error`} errors={[fieldState.error]} />
          </Field>
        );
      }}
    />
  );
}

function ExploreField({ control }: { control: IntakeControl }) {
  return (
    <Controller
      control={control}
      name="exploreCodebase"
      render={({ field }) => (
        <div className="flex min-h-11 items-center gap-3">
          <Checkbox
            ref={field.ref}
            id="intake-explore"
            className="after:-inset-3.5"
            checked={field.value}
            onCheckedChange={field.onChange}
            aria-labelledby="intake-explore-label"
          />
          <label id="intake-explore-label" htmlFor="intake-explore">
            Explore the codebase
          </label>
        </div>
      )}
    />
  );
}

function intakeDefaults(repositories: readonly RepositorySummary[]): IntakeInput {
  const only = repositories.length === 1 ? repositories[0] : undefined;
  return {
    repositoryId: only?.id ?? '',
    description: '',
    ticketUrl: '',
    attachments: [],
    exploreCodebase: true,
    researchTopics: '',
    runMode: only?.defaultRunMode ?? 'manual',
  };
}

/** The intake form, preset from the configured repositories. Start feature opens the new feature. */
export function IntakeForm({ repositories }: { repositories: readonly RepositorySummary[] }) {
  const create = useCreateFeature();
  const navigate = useNavigate();
  const form = useForm<IntakeInput, unknown, IntakeOutput>({
    resolver: zodResolver(IntakeFields),
    defaultValues: intakeDefaults(repositories),
  });
  const submit = form.handleSubmit((intake) =>
    create.mutate(intake, {
      onSuccess: (feature) =>
        void navigate({ to: '/features/$featureId', params: { featureId: feature.id } }),
    }),
  );

  return (
    <Card className="w-full max-w-2xl">
      <CardContent>
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <FieldGroup className="gap-4">
            {repositories.length > 1 && (
              <RepositoryField
                control={form.control}
                repositories={repositories}
                onChoose={(repository) => form.setValue('runMode', repository.defaultRunMode)}
              />
            )}
            <TextField
              control={form.control}
              name="description"
              label="Description"
              hint="Say everything you know: the more context, the fewer questions later."
              rows={8}
            />
            <TextField control={form.control} name="ticketUrl" label="Ticket link" />
            <Controller
              control={form.control}
              name="attachments"
              render={({ field, fieldState }) => (
                <AttachmentsField
                  files={field.value}
                  onFilesChange={(files) =>
                    form.setValue('attachments', files, { shouldValidate: true })
                  }
                  error={fieldState.error}
                  inputRef={field.ref}
                />
              )}
            />
            <ExploreField control={form.control} />
            <TextField
              control={form.control}
              name="researchTopics"
              label="Research topics"
              hint="One topic per line, up to 10. Each runs as its own research task."
              rows={3}
            />
            <Controller
              control={form.control}
              name="runMode"
              render={({ field }) => (
                <RunModeField
                  id="intake-run-mode"
                  label="Run mode"
                  value={field.value}
                  onValueChange={field.onChange}
                  triggerRef={field.ref}
                  onBlur={field.onBlur}
                />
              )}
            />
          </FieldGroup>
          {create.isError && <StartFailed error={create.error} />}
          <Button
            type="submit"
            className="w-full md:w-auto md:self-start"
            disabled={create.isPending}
          >
            {create.isPending ? 'Starting…' : 'Start feature'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
