import { zodResolver } from '@hookform/resolvers/zod';
import { useReviseStep } from '@plangineer/api-client';
import { PlanReviseStepInput } from '@plangineer/contracts';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { PlanActionError } from './plan-action-error';

/** What the engineer asks of the agent. The output keeps the contract's rule for it. */
const ReviseFields = z
  .object({ instruction: z.string().trim().min(1, 'Say what the agent should change.') })
  .pipe(z.object({ instruction: PlanReviseStepInput.shape.instruction }));
type ReviseInput = z.input<typeof ReviseFields>;
type ReviseOutput = z.output<typeof ReviseFields>;

/** Asks the agent to revise one step as the engineer's instruction says. */
export function ReviseStepForm({
  featureId,
  revision,
  stepId,
  onClose,
}: {
  featureId: string;
  revision: number;
  stepId: string;
  onClose: () => void;
}) {
  const revise = useReviseStep();
  const form = useForm<ReviseInput, unknown, ReviseOutput>({
    resolver: zodResolver(ReviseFields),
    defaultValues: { instruction: '' },
  });
  const submit = form.handleSubmit(({ instruction }) =>
    revise.mutate({ featureId, revision, stepId, instruction }, { onSuccess: onClose }),
  );
  const fieldId = `revise-${stepId}`;

  return (
    <form noValidate className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
      <Controller
        control={form.control}
        name="instruction"
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={fieldId}>What should the agent change?</FieldLabel>
            <Textarea
              {...field}
              id={fieldId}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? `${fieldId}-error` : undefined}
            />
            <FieldError id={`${fieldId}-error`} errors={[fieldState.error]} />
          </Field>
        )}
      />
      {revise.isError && (
        <PlanActionError error={revise.error} onRetry={() => revise.mutate(revise.variables)} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={revise.isPending}>
          {revise.isPending ? 'Sending…' : 'Send to agent'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
