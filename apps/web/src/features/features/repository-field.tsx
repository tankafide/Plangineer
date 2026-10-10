import type { RepositorySummary } from '@plangineer/contracts';
import { type Control, Controller } from 'react-hook-form';
import { Field, FieldError, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { IntakeInput, IntakeOutput } from './intake-fields';

/** The intake form's Repository select. Choosing a repository reports it to `onChoose`. */
export function RepositoryField({
  control,
  repositories,
  onChoose,
}: {
  control: Control<IntakeInput, unknown, IntakeOutput>;
  repositories: readonly RepositorySummary[];
  onChoose: (repository: RepositorySummary) => void;
}) {
  const items = repositories.map((repository) => ({
    value: repository.id,
    label: `${repository.owner}/${repository.name}`,
  }));
  return (
    <Controller
      control={control}
      name="repositoryId"
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldTitle id="intake-repository-label">Repository</FieldTitle>
          <Select
            items={items}
            value={field.value === '' ? null : field.value}
            onValueChange={(id) => {
              const repository = repositories.find((candidate) => candidate.id === id);
              if (repository === undefined) return;
              field.onChange(repository.id);
              onChoose(repository);
            }}
          >
            <SelectTrigger
              ref={field.ref}
              className="w-full font-mono"
              aria-labelledby="intake-repository-label"
              aria-invalid={fieldState.invalid}
              aria-describedby={fieldState.invalid ? 'intake-repository-error' : undefined}
              onBlur={field.onBlur}
            >
              <SelectValue placeholder="Choose a repository" />
            </SelectTrigger>
            <SelectContent>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value} className="font-mono">
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError id="intake-repository-error" errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
