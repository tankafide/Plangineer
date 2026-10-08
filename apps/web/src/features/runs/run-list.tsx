import { useRunList } from '@plangineer/api-client';
import type { RunSummary } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { LoadFailed } from '@/components/load-failed';
import { LoadMore } from '@/components/load-more';
import { StaleNotice } from '@/components/stale-notice';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/date-time';
import { RunStatusBadge } from './run-status-badge';

function LoadingRuns() {
  return (
    <output aria-label="Loading runs" className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </output>
  );
}

function RunRow({ run }: { run: RunSummary }) {
  return (
    <Item
      variant="outline"
      className="bg-card"
      render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-mono text-xs break-all">
            {run.repository.owner}/{run.repository.name} at {run.ref}
          </span>
          <RunStatusBadge status={run.status} />
        </ItemTitle>
        <ItemDescription className="break-all">
          {run.runner.name}, {formatDateTime(run.createdAt)}
        </ItemDescription>
      </ItemContent>
    </Item>
  );
}

/** The signed-in user's runs, newest first, each linking to its page. */
export function RunList() {
  const runs = useRunList();
  const retry = () => void runs.refetch();

  if (runs.isPending) return <LoadingRuns />;
  if (runs.isError && runs.data === undefined) {
    return (
      <LoadFailed title="Runs could not be loaded" message={runs.error.message} onRetry={retry} />
    );
  }

  const items = runs.data.pages.flatMap((page) => page.items);
  return (
    <div className="flex flex-col gap-4">
      {runs.isRefetchError && <StaleNotice onRetry={retry} />}
      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No runs yet</EmptyTitle>
            <EmptyDescription>Start a test run with the New test run form.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((run) => (
            <li key={run.id} className="min-w-0">
              <RunRow run={run} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={runs.hasNextPage}
        isFetchingNextPage={runs.isFetchingNextPage}
        nextPageError={runs.isFetchNextPageError ? runs.error : null}
        onLoadMore={() => void runs.fetchNextPage()}
      />
    </div>
  );
}
