import { isApiError, planConflictReason } from '@plangineer/api-client';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RunnerRequiredAlert } from '@/features/features/runner-required-alert';
import { PLAN_CONFLICT_MESSAGES } from './plan-labels';

/**
 * A failed plan write, shown in the card whose button sent it: the conflict's reason, the runner
 * alert, or a plain failure with Retry.
 */
export function PlanActionError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isApiError(error, 'RUNNER_REQUIRED')) {
    return <RunnerRequiredAlert message="No runner is online to run the agent." />;
  }
  const reason = planConflictReason(error);
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription className="flex flex-col items-start gap-2">
        {reason === null ? (
          <>
            The action failed.
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </>
        ) : (
          PLAN_CONFLICT_MESSAGES[reason]
        )}
      </AlertDescription>
    </Alert>
  );
}
