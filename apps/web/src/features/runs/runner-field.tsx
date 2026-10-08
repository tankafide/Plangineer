import { useRunnerList } from '@plangineer/api-client';
import { useEffect } from 'react';
import { type Control, Controller, type FieldPathByValue, type FieldValues } from 'react-hook-form';
import { Field, FieldError, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** The signed-in user's active runners from every page, as select items. */
function useActiveRunners() {
  const runners = useRunnerList();
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = runners;
  // The select must offer every runner, so it loads the pages after the first one in turn.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
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

/**
 * A Runner field for any form that holds a runner id as a string: a select of active runners.
 * `idPrefix` keeps its element ids unique when two forms share a page.
 */
export function RunnerField<TValues extends FieldValues, TOutput>({
  control,
  name,
  idPrefix,
}: {
  control: Control<TValues, unknown, TOutput>;
  name: FieldPathByValue<TValues, string>;
  idPrefix: string;
}) {
  const runners = useActiveRunners();
  const labelId = `${idPrefix}-runner-label`;
  const errorId = `${idPrefix}-runner-error`;
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldTitle id={labelId}>Runner</FieldTitle>
          <Select
            items={runners.items}
            value={field.value === '' ? null : field.value}
            onValueChange={(value) => field.onChange(value ?? '')}
            disabled={runners.isPending}
          >
            <SelectTrigger
              ref={field.ref}
              className="w-full"
              aria-labelledby={labelId}
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? errorId : undefined}
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
          <FieldError id={errorId} errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
