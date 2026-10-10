import { zodResolver } from '@hookform/resolvers/zod';
import { useEditPlan } from '@plangineer/api-client';
import { DONE_WHEN_MAX, type PlanBody, PlanStep } from '@plangineer/contracts';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
import { MarkdownEditor } from '@/components/markdown-editor';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel, FieldTitle } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FULL_SCREEN_ON_PHONE } from '@/lib/full-screen';
import { PlanActionError } from './plan-action-error';
import { replaceStepBody } from './plan-edits';

const toLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

const DoneWhenText = PlanStep.shape.doneWhen.element.shape.text;

/** The step's fields as the form holds them. The output keeps the step schema's rules. */
const StepFields = z
  .object({
    title: z.string().trim().min(1, 'Enter a title.'),
    files: z.string(),
    body: z.string(),
    doneWhen: z.array(
      z.object({
        id: z.string().nullable(),
        text: z.string().trim().min(1, 'Write the line, or remove it.'),
      }),
    ),
  })
  .pipe(
    z.object({
      title: PlanStep.shape.title,
      files: z.string().transform(toLines).pipe(PlanStep.shape.files),
      body: PlanStep.shape.body,
      doneWhen: z
        .array(z.object({ id: z.uuid().nullable(), text: DoneWhenText }))
        .max(DONE_WHEN_MAX),
    }),
  );
type StepInput = z.input<typeof StepFields>;
type StepOutput = z.output<typeof StepFields>;

/** Edits one step in place, full screen on a phone. Save stores a new revision of the plan. */
export function StepForm({
  featureId,
  body,
  step,
  onClose,
}: {
  featureId: string;
  body: PlanBody;
  step: PlanStep;
  onClose: () => void;
}) {
  const edit = useEditPlan(featureId);
  const form = useForm<StepInput, unknown, StepOutput>({
    resolver: zodResolver(StepFields),
    defaultValues: {
      title: step.title,
      files: step.files.join('\n'),
      body: step.body,
      doneWhen: step.doneWhen.map((line) => ({ id: line.id, text: line.text })),
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'doneWhen', keyName: 'key' });
  const submit = form.handleSubmit((fields) =>
    edit.mutate({ body: replaceStepBody(body, step.id, fields) }, { onSuccess: onClose }),
  );
  const fieldId = (name: string) => `step-${step.id}-${name}`;

  return (
    <form
      noValidate
      aria-label={`Edit step ${step.title}`}
      className={FULL_SCREEN_ON_PHONE}
      onSubmit={(event) => void submit(event)}
    >
      <Controller
        control={form.control}
        name="title"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={fieldId('title')}>Title</FieldLabel>
            <Input
              {...field}
              id={fieldId('title')}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? fieldId('title-error') : undefined}
            />
            <FieldError id={fieldId('title-error')} errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="files"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={fieldId('files')}>Files, one per line</FieldLabel>
            <Textarea
              {...field}
              id={fieldId('files')}
              className="font-mono text-xs"
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? fieldId('files-error') : undefined}
            />
            <FieldError id={fieldId('files-error')} errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={form.control}
        name="body"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldTitle id={fieldId('body-label')}>Body</FieldTitle>
            <MarkdownEditor
              value={field.value}
              onChange={field.onChange}
              labelledBy={fieldId('body-label')}
              describedBy={fieldState.invalid ? fieldId('body-error') : undefined}
              invalid={fieldState.invalid}
              className="min-h-48 md:h-64"
            />
            <FieldError id={fieldId('body-error')} errors={[fieldState.error]} />
          </Field>
        )}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Done when</legend>
        {lines.fields.map((line, index) => (
          <Controller
            key={line.key}
            control={form.control}
            name={`doneWhen.${index}.text`}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={fieldId(`line-${index}`)}>{`Line ${index + 1}`}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    {...field}
                    id={fieldId(`line-${index}`)}
                    className="min-w-0 flex-1"
                    aria-invalid={fieldState.invalid}
                    aria-describedby={
                      fieldState.invalid ? fieldId(`line-${index}-error`) : undefined
                    }
                  />
                  <Button
                    variant="outline"
                    aria-label={`Remove line ${index + 1}`}
                    onClick={() => lines.remove(index)}
                  >
                    Remove
                  </Button>
                </div>
                <FieldError id={fieldId(`line-${index}-error`)} errors={[fieldState.error]} />
              </Field>
            )}
          />
        ))}
        <Button
          variant="outline"
          className="w-full md:w-auto md:self-start"
          disabled={lines.fields.length >= DONE_WHEN_MAX}
          onClick={() => lines.append({ id: null, text: '' })}
        >
          Add line
        </Button>
      </fieldset>
      {edit.isError && (
        <PlanActionError error={edit.error} onRetry={() => edit.mutate(edit.variables)} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={edit.isPending}>
          {edit.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
