import { isApiError, useCancelRun } from '@plangineer/api-client';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

function cancelFailure(error: Error): string {
  return isApiError(error, 'CONFLICT')
    ? 'This run has already ended.'
    : `The run could not be cancelled: ${error.message}`;
}

/** Cancel run, confirmed on the card before anything is sent. */
export function CancelRunDecision({ runId }: { runId: string }) {
  const cancel = useCancelRun();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button
        variant="destructive"
        className="w-full md:w-auto md:self-start"
        onClick={() => setConfirming(true)}
      >
        Cancel run
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p>Cancel this run? The runner stops the agent and the run ends cancelled.</p>
      {cancel.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>{cancelFailure(cancel.error)}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ runId }, { onSuccess: () => setConfirming(false) })}
        >
          {cancel.isPending ? 'Cancelling…' : 'Cancel run'}
        </Button>
        <Button variant="outline" disabled={cancel.isPending} onClick={() => setConfirming(false)}>
          Keep running
        </Button>
      </div>
    </div>
  );
}
