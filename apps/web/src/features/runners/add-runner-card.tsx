import { CopyButton } from '@/components/copy-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** The command that pairs a machine with this deployment. It makes no API call. */
export function AddRunnerCard() {
  const command = `npx plangineer-runner login --server ${window.location.origin}`;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Add a runner</h2>
        </CardTitle>
        <CardDescription>
          A runner runs agents on your machine with your own Claude Code login.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <pre className="rounded-lg border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {command}
        </pre>
        <p className="text-muted-foreground">
          Run it on the machine, then approve the request it opens in your browser.
        </p>
        <div>
          <CopyButton value={command} label="Copy command" />
        </div>
      </CardContent>
    </Card>
  );
}
