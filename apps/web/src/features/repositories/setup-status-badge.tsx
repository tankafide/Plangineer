import type { SetupStatus } from '@plangineer/contracts';
import { Badge } from '@/components/ui/badge';

const STATUS_BADGES: Record<
  SetupStatus,
  { label: string; variant: 'info' | 'success' | 'warning' | 'destructive' | 'muted' }
> = {
  scanned: { label: 'Scanned', variant: 'muted' },
  generating: { label: 'Generating', variant: 'info' },
  pr_open: { label: 'Pull request open', variant: 'warning' },
  complete: { label: 'Complete', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

/** A repository's setup status, or Not scanned before its first scan. */
export function SetupStatusBadge({ status }: { status: SetupStatus | null }) {
  if (status === null) return <Badge variant="muted">Not scanned</Badge>;
  const { label, variant } = STATUS_BADGES[status];
  return <Badge variant={variant}>{label}</Badge>;
}
