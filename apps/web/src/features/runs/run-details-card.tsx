import { type Run, TERMINAL_RUN_STATUSES } from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { CopyButton } from '@/components/copy-button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDateTime } from '@/lib/date-time';
import { CancelRunDecision } from './cancel-run-decision';
import { RunStatusBadge } from './run-status-badge';

const SHORT_COMMIT_LENGTH = 12;

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Why a queued run is not moving: its runner is offline or at its plan limit. */
function QueuedNotice({ run }: { run: Run }) {
  const { runner } = run;
  if (run.status !== 'queued') return null;
  const notices: string[] = [];
  if (!runner.online) {
    notices.push(
      runner.lastSeenAt === null
        ? `Waiting for ${runner.name}. It has never connected.`
        : `Waiting for ${runner.name}. It has been offline since ${formatDateTime(runner.lastSeenAt)}.`,
    );
  }
  if (runner.planLimitResetsAt !== null) {
    notices.push(
      `${runner.name} reached its Claude plan limit. Runs resume after ${formatDateTime(runner.planLimitResetsAt)}.`,
    );
  }
  return notices.map((notice) => (
    <Alert key={notice} variant="warning">
      <CircleAlert aria-hidden />
      <AlertDescription>{notice}</AlertDescription>
    </Alert>
  ));
}

function CommitFact({ commit }: { commit: string | null }) {
  if (commit === null) return <Fact term="Commit">Not checked out yet</Fact>;
  return (
    <Fact term="Commit">
      <span className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{commit.slice(0, SHORT_COMMIT_LENGTH)}</span>
        <CopyButton value={commit} label="Copy commit" />
      </span>
    </Fact>
  );
}

/** The run's details, its waiting notices and, until it ends, Cancel run. */
export function RunDetailsCard({ run }: { run: Run }) {
  const isTerminal = TERMINAL_RUN_STATUSES.some((status) => status === run.status);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 font-mono text-sm break-all">
            {run.repository.owner}/{run.repository.name} at {run.ref}
          </h1>
          <RunStatusBadge status={run.status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QueuedNotice run={run} />
        <dl className="flex flex-col gap-3">
          <CommitFact commit={run.commit} />
          <Fact term="Runner">
            <span className="break-all">{run.runner.name}</span>
          </Fact>
          <Fact term="Created">{formatDateTime(run.createdAt)}</Fact>
          <Fact term="Started">
            {run.startedAt === null ? 'Not started' : formatDateTime(run.startedAt)}
          </Fact>
          <Fact term="Ended">
            {run.endedAt === null ? 'Not ended' : formatDateTime(run.endedAt)}
          </Fact>
          <Fact term="Prompt">
            <span className="block break-words whitespace-pre-wrap">{run.prompt}</span>
          </Fact>
        </dl>
        {!isTerminal &&
          (run.cancelRequested ? (
            <p className="text-muted-foreground">
              Cancel requested. Waiting for the runner to stop.
            </p>
          ) : (
            <CancelRunDecision runId={run.id} />
          ))}
      </CardContent>
    </Card>
  );
}
