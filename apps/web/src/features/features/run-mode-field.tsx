import { RunMode } from '@plangineer/contracts';
import type { Ref } from 'react';
import { Field, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RUN_MODE_HINTS, RUN_MODE_LABELS } from '@/lib/run-modes';

const ITEMS = RunMode.options.map((mode) => ({ value: mode, label: RUN_MODE_LABELS[mode] }));

/** A select of the three run modes, with the chosen mode's hint under it. */
export function RunModeField({
  id,
  label,
  value,
  onValueChange,
  disabled = false,
  triggerRef,
  onBlur,
}: {
  id: string;
  label: string;
  value: RunMode;
  onValueChange: (mode: RunMode) => void;
  disabled?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onBlur?: () => void;
}) {
  return (
    <Field>
      <FieldTitle id={`${id}-label`}>{label}</FieldTitle>
      <Select
        items={ITEMS}
        value={value}
        onValueChange={(mode) => {
          if (mode !== null) onValueChange(mode);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          ref={triggerRef}
          className="w-full"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          onBlur={onBlur}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ITEMS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${id}-hint`} className="text-muted-foreground">
        {RUN_MODE_HINTS[value]}
      </p>
    </Field>
  );
}
