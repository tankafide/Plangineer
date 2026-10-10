import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** The answer to RUNNER_REQUIRED: the message saying what could not run, and a link to pair one. */
export function RunnerRequiredAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>
        <p>
          {message} Pair one on the{' '}
          <Link to="/runners" className="text-link underline underline-offset-4">
            Runners
          </Link>{' '}
          screen, then try again.
        </p>
      </AlertDescription>
    </Alert>
  );
}
