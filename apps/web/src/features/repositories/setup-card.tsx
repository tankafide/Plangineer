import { useRefreshSetup, useScanRepository } from '@plangineer/api-client';
import type { RepositoryDetail, RepositoryScan } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RunStatusBadge } from '@/features/runs/run-status-badge';
import { formatDateTime } from '@/lib/date-time';
import { PathList } from './path-list';
import { SetupForm } from './setup-form';
import { SetupStatusBadge } from './setup-status-badge';
import { UnmovableContent } from './unmovable-content';

type Setup = NonNullable<RepositoryDetail['setup']>;

function ErrorAlert({ children }: { children: string }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

function ScanFacts({ scan }: { scan: RepositoryScan }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground">
        Scanned {formatDateTime(scan.scannedAt)} at{' '}
        <span className="font-mono text-xs">{scan.commit.slice(0, 7)}</span> on{' '}
        <span className="font-mono text-xs break-all">{scan.defaultBranch}</span>
      </p>
      <div className="flex flex-col gap-1">
        <p className="font-medium">Instruction files</p>
        {scan.instructionFiles.length === 0 ? (
          <p className="text-muted-foreground">None found</p>
        ) : (
          <PathList paths={scan.instructionFiles} label="Instruction files" />
        )}
      </div>
    </div>
  );
}

function PullRequestLink({ pullRequest }: { pullRequest: NonNullable<Setup['pullRequest']> }) {
  return (
    <a
      href={pullRequest.url}
      className="min-h-11 w-fit content-center text-link underline-offset-4 hover:underline md:min-h-0"
    >
      Pull request #{pullRequest.number}
    </a>
  );
}

function ScanButton({ repositoryId, label }: { repositoryId: string; label: string }) {
  const scan = useScanRepository();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="outline"
        className="w-full md:w-auto md:self-start"
        disabled={scan.isPending}
        onClick={() => scan.mutate({ repositoryId })}
      >
        {scan.isPending ? 'Scanning…' : label}
      </Button>
      {scan.isError && (
        <ErrorAlert>{`The repository could not be scanned: ${scan.error.message}`}</ErrorAlert>
      )}
    </div>
  );
}

function RefreshButton({
  repositoryId,
  label,
  variant,
}: {
  repositoryId: string;
  label: string;
  variant: 'default' | 'outline';
}) {
  const refresh = useRefreshSetup();
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant={variant}
        className="w-full md:w-auto md:self-start"
        disabled={refresh.isPending}
        onClick={() => refresh.mutate({ repositoryId })}
      >
        {refresh.isPending ? 'Checking…' : label}
      </Button>
      {refresh.isError && (
        <ErrorAlert>{`The setup could not be checked: ${refresh.error.message}`}</ErrorAlert>
      )}
    </div>
  );
}

function SetupRunStatus({ run }: { run: Setup['run'] }) {
  if (run === null) return <p className="text-muted-foreground">Waiting for the setup run.</p>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span>Setup run</span>
      <RunStatusBadge status={run.status} />
      {run.startedByViewer && (
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          className="min-h-11 content-center text-link underline-offset-4 hover:underline md:min-h-0"
        >
          View run
        </Link>
      )}
    </div>
  );
}

/** What the setup card shows, and for admins the buttons, for each setup status. */
function SetupBody({
  repositoryId,
  setup,
  isAdmin,
}: {
  repositoryId: string;
  setup: Setup;
  isAdmin: boolean;
}) {
  const scanAgain = isAdmin && <ScanButton repositoryId={repositoryId} label="Scan again" />;
  switch (setup.status) {
    case 'scanned':
      return (
        <>
          <ScanFacts scan={setup.scan} />
          {isAdmin ? (
            <SetupForm repositoryId={repositoryId} scan={setup.scan} selection={setup.selection} />
          ) : (
            setup.scan.unmovableContent.length > 0 && (
              <UnmovableContent paths={setup.scan.unmovableContent} />
            )
          )}
          {scanAgain}
        </>
      );
    case 'generating':
      return (
        <>
          <SetupRunStatus run={setup.run} />
          {isAdmin && (
            <RefreshButton repositoryId={repositoryId} label="Check status" variant="default" />
          )}
        </>
      );
    case 'pr_open':
      return (
        <>
          {setup.pullRequest !== null && <PullRequestLink pullRequest={setup.pullRequest} />}
          {isAdmin && (
            <RefreshButton
              repositoryId={repositoryId}
              label="Check pull request"
              variant="default"
            />
          )}
          {scanAgain}
        </>
      );
    case 'complete':
      return (
        <>
          <p>Setup complete</p>
          {setup.pullRequest !== null && <PullRequestLink pullRequest={setup.pullRequest} />}
          {scanAgain}
        </>
      );
    case 'failed':
      return (
        <>
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertTitle>Setup failed</AlertTitle>
            <AlertDescription className="break-words whitespace-pre-wrap">
              {setup.failureMessage ?? 'No message was recorded.'}
            </AlertDescription>
          </Alert>
          <ScanFacts scan={setup.scan} />
          {isAdmin && (
            <SetupForm repositoryId={repositoryId} scan={setup.scan} selection={setup.selection} />
          )}
          {scanAgain}
        </>
      );
    default: {
      const unknownStatus: never = setup.status;
      throw new Error(`Unknown setup status ${String(unknownStatus)}`);
    }
  }
}

/** The repository's setup: its scan, the choices for the setup pull request, and its progress. */
export function SetupCard({
  repository,
  isAdmin,
}: {
  repository: RepositoryDetail;
  isAdmin: boolean;
}) {
  const { setup } = repository;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <h2>Setup</h2>
          <SetupStatusBadge status={setup?.status ?? null} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {setup === null ? (
          <>
            <p className="text-muted-foreground">Not scanned yet</p>
            {isAdmin && <ScanButton repositoryId={repository.id} label="Scan repository" />}
          </>
        ) : (
          <SetupBody
            key={setup.scan.scannedAt}
            repositoryId={repository.id}
            setup={setup}
            isAdmin={isAdmin}
          />
        )}
      </CardContent>
    </Card>
  );
}
