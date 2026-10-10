import { useRetryTurn } from '@plangineer/api-client';
import { isRunActive, type PlanningTurn } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PlanActionError } from './plan-action-error';
import { TURN_KIND_LABELS } from './plan-labels';

/** A turn runs while its run has not ended: queued, leased or running. */
export function isTurnRunning(turn: PlanningTurn | null): turn is PlanningTurn {
  return turn !== null && isRunActive(turn.status);
}

function ViewRun({ runId }: { runId: string }) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId }}
      className={buttonVariants({ variant: 'outline', className: 'w-full md:w-auto' })}
    >
      View run
    </Link>
  );
}

function RunningTurn({ turn, lastMessage }: { turn: PlanningTurn; lastMessage: string | null }) {
  return (
    <Card size="sm">
      <CardContent className="flex min-w-0 flex-col gap-3">
        <p className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="info">Agent is working</Badge>
          <span className="text-muted-foreground">{TURN_KIND_LABELS[turn.kind]}</span>
        </p>
        {lastMessage !== null && (
          <p className="line-clamp-4 break-words whitespace-pre-wrap">{lastMessage}</p>
        )}
        <ViewRun runId={turn.runId} />
      </CardContent>
    </Card>
  );
}

function EndedTurn({ featureId, turn }: { featureId: string; turn: PlanningTurn }) {
  const retry = useRetryTurn();
  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>
          {turn.status === 'cancelled'
            ? "The agent's turn was cancelled"
            : "The agent's turn failed"}
        </AlertTitle>
        <AlertDescription className="flex flex-col gap-2 md:flex-row">
          <Button
            variant="outline"
            className="w-full md:w-auto"
            disabled={retry.isPending}
            onClick={() => retry.mutate({ featureId })}
          >
            {retry.isPending ? 'Retrying…' : 'Retry'}
          </Button>
          <ViewRun runId={turn.runId} />
        </AlertDescription>
      </Alert>
      {retry.isError && (
        <PlanActionError error={retry.error} onRetry={() => retry.mutate({ featureId })} />
      )}
    </div>
  );
}

/**
 * The latest turn: the agent at work with its last message while it runs, or the failure with
 * Retry. A turn that succeeded shows nothing, since its result is the plan.
 */
export function TurnStatus({
  featureId,
  turn,
  lastMessage,
}: {
  featureId: string;
  turn: PlanningTurn | null;
  lastMessage: string | null;
}) {
  if (turn === null || turn.status === 'succeeded') return null;
  if (isTurnRunning(turn)) return <RunningTurn turn={turn} lastMessage={lastMessage} />;
  return <EndedTurn featureId={featureId} turn={turn} />;
}
