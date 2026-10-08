import type { RunStatus } from '@plangineer/contracts';
import { Badge } from '@/components/ui/badge';

const STATUS_BADGES: Record<
  RunStatus,
  { label: string; variant: 'info' | 'success' | 'destructive' | 'muted' }
> = {
  queued: { label: 'Queued', variant: 'info' },
  leased: { label: 'Starting', variant: 'info' },
  running: { label: 'Running', variant: 'info' },
  succeeded: { label: 'Succeeded', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'muted' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { label, variant } = STATUS_BADGES[status];
  return <Badge variant={variant}>{label}</Badge>;
}
