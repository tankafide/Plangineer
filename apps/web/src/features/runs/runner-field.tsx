import { useRunnerList } from '@plangineer/api-client';
import { type Control, Controller } from 'react-hook-form';
import { Field, FieldError, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { NewRunInput, NewRunOutput } from './new-run-fields';

const LABEL_ID = 'new-run-runner-label';
const ERROR_ID = 'new-run-runner-error';

/** The signed-in user's active runners, as select items. */
function useActiveRunners() {
  const runners = useRunnerList();
  const items = (runners.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((runner) => runner.status === 'active')
    .map((runner) => ({ value: runner.id, label: runner.name }));
  return { items, isPending: runners.isPending, error: runners.error };
}

function RunnerHint({ runners }: { runners: ReturnType<typeof useActiveRunners> }) {
  if (runners.error !== null) {
    return <p className="text-destructive">Runners could not be loaded: {runners.error.message}</p>;
  }
  if (!runners.isPending && runners.items.length === 0) {
    return <p className="text-muted-foreground">Pair a runner on the Runners screen first.</p>;
  }
  return null;
}

/** The Runner field of the New test run form: a select of active runners. */
export function RunnerField({ control }: { control: Control<NewRunInput, unknown, NewRunOutput> }) {
  const runners = useActiveRunners();
  return (
    <Controller
      control={control}
      name="runnerId"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldTitle id={LABEL_ID}>Runner</FieldTitle>
          <Select
            items={runners.items}
            value={field.value === '' ? null : field.value}
            onValueChange={(value) => field.onChange(value ?? '')}
            disabled={runners.isPending}
          >
            <SelectTrigger
              ref={field.ref}
              className="w-full"
              aria-labelledby={LABEL_ID}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? ERROR_ID : undefined}
              onBlur={field.onBlur}
            >
              <SelectValue
                placeholder={runners.isPending ? 'Loading runners…' : 'Choose a runner'}
              />
            </SelectTrigger>
            <SelectContent>
              {runners.items.map((runner) => (
                <SelectItem key={runner.value} value={runner.value}>
                  {runner.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <RunnerHint runners={runners} />
          <FieldError id={ERROR_ID} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
