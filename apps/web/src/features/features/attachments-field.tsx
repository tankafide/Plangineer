import { AttachmentMediaType } from '@plangineer/contracts';
import type { Ref } from 'react';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const ACCEPT = AttachmentMediaType.options.join(',');
const SIZE = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${SIZE.format(bytes / 1024)} KiB`;
  return `${SIZE.format(bytes / (1024 * 1024))} MiB`;
}

/** A file picker that adds to a list of chosen files, each with its size and Remove. */
export function AttachmentsField({
  files,
  onFilesChange,
  error,
  inputRef,
}: {
  files: readonly File[];
  onFilesChange: (files: File[]) => void;
  error: { message?: string } | undefined;
  inputRef: Ref<HTMLInputElement>;
}) {
  const invalid = error !== undefined;
  const describedBy = ['intake-attachments-hint', invalid && 'intake-attachments-error']
    .filter(Boolean)
    .join(' ');
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor="intake-attachments">Attachments</FieldLabel>
      <p id="intake-attachments-hint" className="text-muted-foreground">
        Screenshots, PDFs, text and Markdown. Up to 10 files, 10 MiB each and 25 MiB in all.
      </p>
      <Input
        ref={inputRef}
        id="intake-attachments"
        type="file"
        multiple
        accept={ACCEPT}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? []);
          // The list holds the files, so the input empties to take the same file again.
          event.target.value = '';
          if (chosen.length > 0) onFilesChange([...files, ...chosen]);
        }}
      />
      {files.length > 0 && (
        <ul aria-label="Chosen files" className="flex flex-col gap-2">
          {files.map((file, index) => (
            <li
              key={`${index}-${file.name}`}
              className="flex min-w-0 items-center gap-3 rounded-lg border px-3 py-1"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="break-all">{file.name}</span>
                <span className="text-muted-foreground tabular-nums">{formatSize(file.size)}</span>
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={`Remove ${file.name}`}
                onClick={() => onFilesChange(files.filter((_, other) => other !== index))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <FieldError id="intake-attachments-error" errors={[error]} />
    </Field>
  );
}
