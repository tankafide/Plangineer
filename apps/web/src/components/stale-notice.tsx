import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="warning">
      <CircleAlert aria-hidden />
      <AlertTitle>Stale</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        These details could not be refreshed.
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
