import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError, useAddRepository, useInstallableRepositoryList } from '@plangineer/api-client';
import {
  type InstallableRepository,
  RepositoryAddInput,
  type RepositoryListInstallableOutput,
} from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import { type Control, Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LoadFailed } from '@/components/load-failed';
import { StaleNotice } from '@/components/stale-notice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';

/** The add form. Its output is the repository.add input, so the contract checks both. */
const AddRepositoryFields = z
  .object({
    githubRepositoryId: z.string().min(1, 'Choose a repository.'),
    description: z.string().trim().min(1, 'Describe the repository.'),
  })
  .transform((fields) => ({ ...fields, githubRepositoryId: Number(fields.githubRepositoryId) }))
  .pipe(RepositoryAddInput);
type AddRepositoryInput = z.input<typeof AddRepositoryFields>;
type AddRepositoryOutput = z.output<typeof AddRepositoryFields>;

const EMPTY_FORM: AddRepositoryInput = { githubRepositoryId: '', description: '' };

function fullName(repository: InstallableRepository): string {
  return `${repository.owner}/${repository.name}`;
}

function addFailure(error: Error): string {
  if (isApiError(error, 'CONFLICT')) return 'That repository is already added.';
  if (isApiError(error, 'NOT_FOUND')) {
    return 'Plangineer can no longer reach that repository on GitHub. Choose another.';
  }
  return `The repository could not be added: ${error.message}`;
}

function InstallPrompt({ installUrl }: { installUrl: string }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground">
        Give Plangineer access to a repository on GitHub, then come back here.
      </p>
      <a
        href={installUrl}
        className={buttonVariants({ className: 'w-full md:w-auto md:self-start' })}
      >
        Install on GitHub
      </a>
    </div>
  );
}

function RepositoryField({
  control,
  installable,
}: {
  control: Control<AddRepositoryInput, unknown, AddRepositoryOutput>;
  installable: RepositoryListInstallableOutput;
}) {
  const items = installable.items.map((repository) => ({
    value: String(repository.githubRepositoryId),
    label: fullName(repository),
  }));
  return (
    <Controller
      control={control}
      name="githubRepositoryId"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldTitle id="add-repository-label">Repository</FieldTitle>
          <Select
            items={items}
            value={field.value === '' ? null : field.value}
            onValueChange={(next) => field.onChange(next ?? '')}
          >
            <SelectTrigger
              ref={field.ref}
              className="w-full"
              aria-labelledby="add-repository-label"
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? 'add-repository-error' : undefined}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder="Choose a repository" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  <span className="font-mono text-xs break-all">{item.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {installable.truncated && (
            <p className="text-muted-foreground">Showing the first 1,000 repositories.</p>
          )}
          <a
            href={installable.installUrl}
            className="min-h-11 w-fit content-center text-link underline-offset-4 hover:underline md:min-h-0"
          >
            Choose repositories on GitHub
          </a>
          <FieldError id="add-repository-error" errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function AddRepositoryForm({ installable }: { installable: RepositoryListInstallableOutput }) {
  const add = useAddRepository();
  const form = useForm<AddRepositoryInput, unknown, AddRepositoryOutput>({
    resolver: zodResolver(AddRepositoryFields),
    defaultValues: EMPTY_FORM,
  });
  const submit = form.handleSubmit((input) =>
    add.mutate(input, { onSuccess: () => form.reset(EMPTY_FORM) }),
  );

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      <FieldGroup className="gap-4">
        <RepositoryField control={form.control} installable={installable} />
        <Controller
          control={form.control}
          name="description"
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="add-repository-description">Description</FieldLabel>
              <Textarea
                {...field}
                id="add-repository-description"
                rows={3}
                maxLength={200}
                aria-invalid={fieldState.invalid}
                aria-describedby={
                  fieldState.invalid ? 'add-repository-description-error' : undefined
                }
              />
              <FieldError id="add-repository-description-error" errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <Button type="submit" className="w-full md:w-auto md:self-start" disabled={add.isPending}>
        {add.isPending ? 'Adding…' : 'Add repository'}
      </Button>
      {add.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{addFailure(add.error)}</AlertDescription>
        </Alert>
      )}
    </form>
  );
}

function AddRepositoryContent() {
  const installable = useInstallableRepositoryList();
  const retry = () => void installable.refetch();

  if (installable.isPending) {
    return (
      <output aria-label="Loading repositories on GitHub" className="flex flex-col gap-3">
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </output>
    );
  }
  if (installable.isError && installable.data === undefined) {
    return (
      <LoadFailed
        title="Repositories on GitHub could not be loaded"
        message={installable.error.message}
        onRetry={retry}
      />
    );
  }
  return (
    <>
      {installable.isRefetchError && <StaleNotice onRetry={retry} />}
      {installable.data.items.length === 0 ? (
        <InstallPrompt installUrl={installable.data.installUrl} />
      ) : (
        <AddRepositoryForm installable={installable.data} />
      )}
    </>
  );
}

/** For admins: adds a repository the GitHub App reaches, or links to installing the App. */
export function AddRepositoryCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Add a repository</h2>
        </CardTitle>
        <CardDescription>Plangineer reads it through its GitHub App.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <AddRepositoryContent />
      </CardContent>
    </Card>
  );
}
