import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError, useCreateRun } from '@plangineer/api-client';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { type Control, Controller, useForm } from 'react-hook-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NewRunFields, type NewRunInput, type NewRunOutput } from './new-run-fields';
import { RunnerField } from './runner-field';

const EMPTY_FORM: NewRunInput = { runnerId: '', repository: '', ref: '', prompt: '' };

function TextField({
  control,
  name,
  label,
  placeholder,
}: {
  control: Control<NewRunInput, unknown, NewRunOutput>;
  name: 'repository' | 'ref';
  label: string;
  placeholder: string;
}) {
  const id = `new-run-${name}`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          <Input
            {...field}
            id={id}
            className="font-mono"
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.invalid ? `${id}-error` : undefined}
          />
          <FieldError id={`${id}-error`} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function PromptField({ control }: { control: Control<NewRunInput, unknown, NewRunOutput> }) {
  return (
    <Controller
      control={control}
      name="prompt"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor="new-run-prompt">Prompt</FieldLabel>
          <Textarea
            {...field}
            id="new-run-prompt"
            rows={5}
            aria-invalid={fieldState.invalid}
            aria-describedby={fieldState.invalid ? 'new-run-prompt-error' : undefined}
          />
          <FieldError id="new-run-prompt-error" errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

/** The New test run form. A valid submit starts the run and opens its page. */
export function NewRunForm() {
  const createRun = useCreateRun();
  const navigate = useNavigate();
  const form = useForm<NewRunInput, unknown, NewRunOutput>({
    resolver: zodResolver(NewRunFields),
    defaultValues: EMPTY_FORM,
  });

  const submit = form.handleSubmit((input) =>
    createRun.mutate(input, {
      onSuccess: (run) => void navigate({ to: '/runs/$runId', params: { runId: run.id } }),
      onError: (error) => {
        if (isApiError(error, 'NOT_FOUND')) {
          form.setError('runnerId', { message: 'That runner no longer exists. Choose another.' });
        } else if (isApiError(error, 'CONFLICT')) {
          form.setError('runnerId', { message: 'That runner was revoked. Choose another.' });
        }
      },
    }),
  );
  const startFailed =
    createRun.isError &&
    !isApiError(createRun.error, 'NOT_FOUND') &&
    !isApiError(createRun.error, 'CONFLICT');

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>New test run</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          <FieldGroup className="gap-4">
            <RunnerField control={form.control} name="runnerId" idPrefix="new-run" />
            <TextField
              control={form.control}
              name="repository"
              label="Repository"
              placeholder="owner/name"
            />
            <TextField control={form.control} name="ref" label="Ref" placeholder="main" />
            <PromptField control={form.control} />
          </FieldGroup>
          {startFailed && (
            <Alert variant="destructive">
              <CircleAlert aria-hidden />
              <AlertDescription>
                The run could not be started: {createRun.error.message}
              </AlertDescription>
            </Alert>
          )}
          <Button
            type="submit"
            className="w-full md:w-auto md:self-start"
            disabled={createRun.isPending}
          >
            {createRun.isPending ? 'Starting…' : 'Start run'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
