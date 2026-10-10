import { zodResolver } from '@hookform/resolvers/zod';
import { isApiError, useContextFile, useUpdateContextFile } from '@plangineer/api-client';
import {
  CONTEXT_FILE_CONTENT_MAX,
  CONTEXT_FILE_TITLE_MAX,
  type ContextFile,
  ContextFileUpdateInput,
} from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { LoadFailed } from '@/components/load-failed';
import { MarkdownEditor } from '@/components/markdown-editor';
import { StaleNotice } from '@/components/stale-notice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { FULL_SCREEN_ON_PHONE } from '@/lib/full-screen';
import { DeleteContextFile } from './delete-context-file';

/** The file's title and text. The output keeps the contract's rules for both. */
const ContextFileFields = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'Enter a title.')
      .max(CONTEXT_FILE_TITLE_MAX, `Keep the title to ${CONTEXT_FILE_TITLE_MAX} characters.`),
    content: z
      .string()
      .min(1, 'The file cannot be empty.')
      .max(CONTEXT_FILE_CONTENT_MAX, 'The file is longer than the 65,536 characters allowed.'),
  })
  .pipe(
    z.object({
      title: ContextFileUpdateInput.shape.title.unwrap(),
      content: ContextFileUpdateInput.shape.content.unwrap(),
    }),
  );
type ContextFileInput = z.input<typeof ContextFileFields>;
type ContextFileOutput = z.output<typeof ContextFileFields>;

function BackLink({ featureId }: { featureId: string }) {
  return (
    <Link
      to="/features/$featureId"
      params={{ featureId }}
      className={buttonVariants({ variant: 'ghost', className: 'self-start' })}
    >
      <ArrowLeft aria-hidden />
      Back
    </Link>
  );
}

function LoadingContextFile() {
  return (
    <output aria-label="Loading context file" className="flex flex-col gap-3">
      <Skeleton className="h-11 w-24 rounded-lg" />
      <Skeleton className="h-11 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </output>
  );
}

function ContextFileNotFound({ featureId }: { featureId: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          <h1>Context file not found</h1>
        </EmptyTitle>
        <EmptyDescription>It was deleted, or it belongs to someone else.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link
          to="/features/$featureId"
          params={{ featureId }}
          className={buttonVariants({ variant: 'outline' })}
        >
          Back to the feature
        </Link>
      </EmptyContent>
    </Empty>
  );
}

/** The fields Save changes: only those that differ from the saved file. */
function changedFields(file: ContextFile, values: ContextFileOutput) {
  return {
    ...(values.title !== file.title && { title: values.title }),
    ...(values.content !== file.content && { content: values.content }),
  };
}

function ContextFileEditor({ file, stale }: { file: ContextFile; stale: ReactNode }) {
  const update = useUpdateContextFile();
  const form = useForm<ContextFileInput, unknown, ContextFileOutput>({
    resolver: zodResolver(ContextFileFields),
    defaultValues: { title: file.title, content: file.content },
  });
  const submit = form.handleSubmit((values) =>
    update.mutate(
      { contextFileId: file.id, ...changedFields(file, values) },
      { onSuccess: (saved) => form.reset({ title: saved.title, content: saved.content }) },
    ),
  );
  const saved = update.isSuccess && !form.formState.isDirty;

  return (
    <form noValidate className={FULL_SCREEN_ON_PHONE} onSubmit={(event) => void submit(event)}>
      <BackLink featureId={file.featureId} />
      {stale}
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="context-file-title">Title</FieldLabel>
            <Input
              {...field}
              id="context-file-title"
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? 'context-file-title-error' : undefined}
            />
            <FieldError id="context-file-title-error" errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="content"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid} className="min-h-0 flex-1">
            <FieldTitle id="context-file-content-label">Content</FieldTitle>
            <MarkdownEditor
              value={field.value}
              onChange={field.onChange}
              labelledBy="context-file-content-label"
              describedBy={fieldState.invalid ? 'context-file-content-error' : undefined}
              invalid={fieldState.invalid}
              className="min-h-64 flex-1 md:h-128 md:flex-none"
            />
            <FieldError id="context-file-content-error" errors={[fieldState.error]} />
          </Field>
        )}
      />
      {update.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>The file could not be saved: {update.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={update.isPending || !form.formState.isDirty}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        {saved && <p className="text-muted-foreground">Saved.</p>}
        <DeleteContextFile featureId={file.featureId} contextFileId={file.id} />
      </div>
    </form>
  );
}

/** One context file to rename, edit and save, or delete. Full screen on a phone. */
export function ContextFileScreen({
  featureId,
  contextFileId,
}: {
  featureId: string;
  contextFileId: string;
}) {
  const file = useContextFile(contextFileId);
  const retry = () => void file.refetch();

  if (file.isPending) return <LoadingContextFile />;
  if (file.isError && file.data === undefined) {
    if (isApiError(file.error, 'NOT_FOUND')) return <ContextFileNotFound featureId={featureId} />;
    return (
      <LoadFailed
        title="The context file could not be loaded"
        message={file.error.message}
        onRetry={retry}
      />
    );
  }
  if (file.data.featureId !== featureId) return <ContextFileNotFound featureId={featureId} />;

  return (
    <ContextFileEditor
      key={file.data.id}
      file={file.data}
      stale={file.isRefetchError && <StaleNotice onRetry={retry} />}
    />
  );
}
