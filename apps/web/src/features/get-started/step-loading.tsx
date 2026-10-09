import { Skeleton } from '@/components/ui/skeleton';

/** A step's line while its read loads for the first time. */
export function StepLoading({ label }: { label: string }) {
  return (
    <output aria-label={label} className="block">
      <Skeleton className="h-5 w-2/3" />
    </output>
  );
}
