import { isApiError, startPlanningConflictReason, useStartPlanning } from '@plangineer/api-client';
import type { FeatureDetail, StartPlanningConflictData } from '@plangineer/contracts';
import { startPlanning } from '@plangineer/domain';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RunnerRequiredAlert } from './runner-required-alert';

const AUTO_LOOP_NOTICE = 'Planning starts by itself under Auto loop.';

const CONFLICT_MESSAGES: Record<StartPlanningConflictData['reason'], string> = {
  auto_loop: AUTO_LOOP_NOTICE,
  already_planning: 'Planning has already started.',
};

type StartError = NonNullable<ReturnType<typeof useStartPlanning>['error']>;

function StartFailed({ error }: { error: StartError }) {
  if (isApiError(error, 'RUNNER_REQUIRED'))
    return <RunnerRequiredAlert message="No runner can take this feature." />;
  const reason = startPlanningConflictReason(error);
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        {reason === null ? `Planning could not start: ${error.message}` : CONFLICT_MESSAGES[reason]}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Start planning, shown only when the feature's state and run mode allow it, which opens the plan
 * once it starts. Under Auto loop a plan-ready feature says that planning starts by itself instead.
 */
export function StartPlanning({ feature }: { feature: FeatureDetail }) {
  const start = useStartPlanning();
  const navigate = useNavigate();
  const verdict = startPlanning(feature.state, feature.runMode);

  if (!verdict.ok) {
    if (verdict.reason === 'auto_loop' && feature.state === 'plan_ready') {
      return <p className="text-muted-foreground">{AUTO_LOOP_NOTICE}</p>;
    }
    return null;
  }
  return (
    <div className="flex flex-col gap-3">
      {start.isError && <StartFailed error={start.error} />}
      <Button
        className="w-full md:w-auto md:self-start"
        disabled={start.isPending}
        // Success stores the feature as planning, which unmounts this button before callbacks
        // passed to mutate would run, so the plan opens from mutateAsync. A failure shows in
        // StartFailed through start.error.
        onClick={() =>
          start.mutateAsync({ featureId: feature.id }).then(
            () => navigate({ to: '/features/$featureId/plan', params: { featureId: feature.id } }),
            () => undefined,
          )
        }
      >
        {start.isPending ? 'Starting…' : 'Start planning'}
      </Button>
    </div>
  );
}
