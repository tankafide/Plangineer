import { useRevokeRunner } from '@plangineer/api-client';
import { CLAUDE_CODE_MIN_VERSION, type Runner, type RunnerPlatform } from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/date-time';

const PLATFORM_LABELS: Record<RunnerPlatform, string> = {
  win32: 'Windows',
  darwin: 'macOS',
  linux: 'Linux',
};

function RunnerStatusBadge({ runner }: { runner: Runner }) {
  if (runner.status === 'revoked') return <Badge variant="muted">Revoked</Badge>;
  return runner.online ? (
    <Badge variant="success">Online</Badge>
  ) : (
    <Badge variant="warning">Offline</Badge>
  );
}

function claudeCodeStatus(runner: Runner): string {
  const cli = runner.clis.find((status) => status.name === 'claude-code');
  if (cli?.available === true && cli.version !== null) return `Claude Code ${cli.version}`;
  return `Claude Code unavailable, needs ${cli?.minimumVersion ?? CLAUDE_CODE_MIN_VERSION} or later`;
}

function RunnerFacts({ runner }: { runner: Runner }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">Last seen</dt>
      <dd>{runner.lastSeenAt === null ? 'Never connected' : formatDateTime(runner.lastSeenAt)}</dd>
      <dt className="text-muted-foreground">Agent</dt>
      <dd>{claudeCodeStatus(runner)}</dd>
      <dt className="text-muted-foreground">Runs at once</dt>
      <dd className="tabular-nums">{runner.concurrencyLimit ?? 'Not reported yet'}</dd>
      {runner.revokedAt !== null && (
        <>
          <dt className="text-muted-foreground">Revoked</dt>
          <dd>{formatDateTime(runner.revokedAt)}</dd>
        </>
      )}
    </dl>
  );
}

function RevokeDecision({ runner, onClose }: { runner: Runner; onClose: () => void }) {
  const revoke = useRevokeRunner();
  return (
    <div className="flex flex-col gap-3">
      <p>
        Revoke {runner.name}? Its queued and running runs are cancelled, and the machine must be
        paired again to run anything.
      </p>
      {revoke.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            The runner could not be revoked: {revoke.error.message}
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate({ runnerId: runner.id }, { onSuccess: onClose })}
        >
          {revoke.isPending ? 'Revoking…' : 'Revoke runner'}
        </Button>
        <Button variant="outline" disabled={revoke.isPending} onClick={onClose}>
          Keep runner
        </Button>
      </div>
    </div>
  );
}

/** One runner: its state, its agent CLI and, while active, Revoke. */
export function RunnerCard({ runner }: { runner: Runner }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 className="min-w-0 break-all">{runner.name}</h3>
          <RunnerStatusBadge runner={runner} />
        </CardTitle>
        <CardDescription>{PLATFORM_LABELS[runner.platform]}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <RunnerFacts runner={runner} />
        {runner.planLimitResetsAt !== null && (
          <Alert variant="warning">
            <CircleAlert aria-hidden />
            <AlertDescription>
              Reached its Claude plan limit. Runs resume after{' '}
              {formatDateTime(runner.planLimitResetsAt)}.
            </AlertDescription>
          </Alert>
        )}
        {runner.status === 'active' &&
          (confirming ? (
            <RevokeDecision runner={runner} onClose={() => setConfirming(false)} />
          ) : (
            <Button
              variant="outline"
              className="w-full md:w-auto md:self-start"
              onClick={() => setConfirming(true)}
            >
              Revoke
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
