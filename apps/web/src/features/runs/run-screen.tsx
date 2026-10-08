import { isApiError, useRun, useRunEvents } from '@plangineer/api-client';
import type { RunEvent } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { LoadFailed } from '@/components/load-failed';
import { StaleNotice } from '@/components/stale-notice';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { RunDetailsCard } from './run-details-card';
import { RunEventList } from './run-event-list';
import { RunResultCard } from './run-result-card';
import { StreamStatus } from './stream-status';

const PAGE_LAYOUT = 'flex flex-col gap-4 lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start';

function LoadingRun() {
  return (
    <output aria-label="Loading run" className={PAGE_LAYOUT}>
      <Skeleton className="h-96 w-full rounded-xl" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </output>
  );
}

function RunNotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          <h1>Run not found</h1>
        </EmptyTitle>
        <EmptyDescription>It does not exist, or it belongs to someone else.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/runs" className={buttonVariants({ variant: 'outline' })}>
          Back to runs
        </Link>
      </EmptyContent>
    </Empty>
  );
}

function terminalEvent(events: readonly RunEvent[]) {
  const last = events.at(-1);
  if (last === undefined) return null;
  switch (last.type) {
    case 'run.succeeded':
    case 'run.failed':
    case 'run.cancelled':
      return last;
    default:
      return null;
  }
}

/** One run: its details, its live event stream and how it ended. */
export function RunScreen({ runId }: { runId: string }) {
  const run = useRun(runId);
  const stream = useRunEvents(runId);
  const retryRun = () => void run.refetch();

  if (run.isPending) return <LoadingRun />;
  if (run.isError && run.data === undefined) {
    if (isApiError(run.error, 'NOT_FOUND')) return <RunNotFound />;
    return (
      <LoadFailed
        title="The run could not be loaded"
        message={run.error.message}
        onRetry={retryRun}
      />
    );
  }

  const ended = terminalEvent(stream.events);
  return (
    <div className={PAGE_LAYOUT}>
      <div className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4">
        {run.isRefetchError && <StaleNotice onRetry={retryRun} />}
        <RunDetailsCard run={run.data} />
      </div>
      <section aria-labelledby="run-events" className="flex min-w-0 flex-col gap-3">
        <h2 id="run-events" className="text-base font-semibold">
          Events
        </h2>
        <StreamStatus state={stream.state} onRetry={stream.retry} />
        <RunEventList events={stream.events} />
        {ended !== null && <RunResultCard event={ended} />}
      </section>
    </div>
  );
}
