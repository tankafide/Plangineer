import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** A step's read that failed: what could not load, the error, and Try again. */
export function StepFailed({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <>
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="break-words">{message}</AlertDescription>
      </Alert>
      <Button variant="outline" className="w-full md:w-auto md:self-start" onClick={onRetry}>
        Try again
      </Button>
    </>
  );
}
