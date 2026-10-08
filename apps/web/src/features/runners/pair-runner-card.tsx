import { isApiError, useCreatePairingCode } from '@plangineer/api-client';
import { CircleAlert } from 'lucide-react';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/date-time';

function pairingFailure(error: Error): string {
  return isApiError(error, 'TOO_MANY_REQUESTS')
    ? 'Too many pairing codes. Try again in a few minutes.'
    : `A pairing code could not be created: ${error.message}`;
}

function PairingCommand({
  code,
  expiresAt,
  onDone,
}: {
  code: string;
  expiresAt: string;
  onDone: () => void;
}) {
  const command = `pnpm runner pair --server ${window.location.origin} --code ${code}`;
  return (
    <>
      <p className="text-muted-foreground">
        Run this in your Plangineer checkout on the machine to pair.
      </p>
      <pre className="rounded-lg border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {command}
      </pre>
      <p className="text-muted-foreground">
        The code works once and expires at {formatDateTime(expiresAt)}.
      </p>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={command} label="Copy command" />
        <Button variant="ghost" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </>
  );
}

/** Creates a pairing code and shows the command that pairs a machine with it. */
export function PairRunnerCard() {
  const pairing = useCreatePairingCode();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Pair a runner</h2>
        </CardTitle>
        <CardDescription>
          A runner runs agents on your machine with your own Claude Code login.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pairing.isError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{pairingFailure(pairing.error)}</AlertDescription>
          </Alert>
        )}
        {pairing.data === undefined ? (
          <Button
            className="w-full md:w-auto md:self-start"
            disabled={pairing.isPending}
            onClick={() => pairing.mutate(undefined)}
          >
            {pairing.isPending ? 'Creating a code…' : 'Pair a runner'}
          </Button>
        ) : (
          <PairingCommand
            code={pairing.data.code}
            expiresAt={pairing.data.expiresAt}
            onDone={() => pairing.reset()}
          />
        )}
      </CardContent>
    </Card>
  );
}
