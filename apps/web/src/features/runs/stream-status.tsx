import type { RunEventStreamState } from '@plangineer/api-client';
import { CircleAlert } from 'lucide-react';
import { StaleNotice } from '@/components/stale-notice';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

function StreamBadge({ variant, children }: { variant: 'muted' | 'info'; children: string }) {
  return (
    <output aria-label="Event stream">
      <Badge variant={variant}>{children}</Badge>
    </output>
  );
}

/** Whether the event list below is live, catching up, finished, or cut off. */
export function StreamStatus({
  state,
  onRetry,
}: {
  state: RunEventStreamState;
  onRetry: () => void;
}) {
  switch (state.status) {
    case 'connecting':
      return <StreamBadge variant="muted">Connecting</StreamBadge>;
    case 'live':
      return <StreamBadge variant="info">Live</StreamBadge>;
    case 'reconnecting':
      return <StaleNotice onRetry={onRetry} />;
    case 'ended':
      return <StreamBadge variant="muted">Ended</StreamBadge>;
    case 'failed':
      return (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Failed</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            The event stream stopped: {state.error.message}
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      );
    default: {
      const unknownState: never = state;
      throw new Error(`Unknown stream state ${JSON.stringify(unknownState)}`);
    }
  }
}
