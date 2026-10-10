import type { FeatureState } from '@plangineer/contracts';
import { Badge } from '@/components/ui/badge';

const STATE_BADGES: Record<FeatureState, { label: string; variant: 'info' | 'warning' }> = {
  pre_planning: { label: 'Pre-planning', variant: 'info' },
  // Plan ready waits on the engineer to start planning.
  plan_ready: { label: 'Plan ready', variant: 'warning' },
  planning: { label: 'Planning', variant: 'info' },
};

export function FeatureStateBadge({ state }: { state: FeatureState }) {
  const { label, variant } = STATE_BADGES[state];
  return <Badge variant={variant}>{label}</Badge>;
}
