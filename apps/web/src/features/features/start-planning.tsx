import { startPlanningConflictReason, useStartPlanning } from '@plangineer/api-client';
import type { FeatureDetail, StartPlanningConflictData } from '@plangineer/contracts';
import { startPlanning } from '@plangineer/domain';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

const AUTO_LOOP_NOTICE = 'Planning starts by itself under Auto loop.';

const CONFLICT_MESSAGES: Record<StartPlanningConflictData['reason'], string> = {
  auto_loop: AUTO_LOOP_NOTICE,
  already_planning: 'Planning has already started.',
};

function startFailure(error: NonNullable<ReturnType<typeof useStartPlanning>['error']>): string {
  const reason = startPlanningConflictReason(error);
  return reason === null ? `Planning could not start: ${error.message}` : CONFLICT_MESSAGES[reason];
}

/**
 * Start planning, shown only when the feature's state and run mode allow it. Under Auto loop a
 * plan-ready feature says that planning starts by itself instead.
 */
export function StartPlanning({ feature }: { feature: FeatureDetail }) {
  const start = useStartPlanning();
  const verdict = startPlanning(feature.state, feature.runMode);

  if (!verdict.ok) {
    if (verdict.reason === 'auto_loop' && feature.state === 'plan_ready') {
      return <p className="text-muted-foreground">{AUTO_LOOP_NOTICE}</p>;
    }
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {start.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{startFailure(start.error)}</AlertDescription>
        </Alert>
      )}
      <Button
        className="w-full md:w-auto md:self-start"
        disabled={start.isPending}
        onClick={() => start.mutate({ featureId: feature.id })}
      >
        {start.isPending ? 'Starting…' : 'Start planning'}
      </Button>
    </div>
  );
}
