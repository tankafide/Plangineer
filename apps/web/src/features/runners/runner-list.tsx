import { useRunnerList } from '@plangineer/api-client';
import { LoadFailed } from '@/components/load-failed';
import { LoadMore } from '@/components/load-more';
import { StaleNotice } from '@/components/stale-notice';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { RunnerCard } from './runner-card';

function LoadingRunners() {
  return (
    <output aria-label="Loading runners" className="grid gap-4 md:grid-cols-2">
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </output>
  );
}

/** The signed-in user's runners, with the loading, empty, failed and stale states. */
export function RunnerList() {
  const runners = useRunnerList();
  const retry = () => void runners.refetch();

  if (runners.isPending) return <LoadingRunners />;
  if (runners.isError && runners.data === undefined) {
    return (
      <LoadFailed
        title="Runners could not be loaded"
        message={runners.error.message}
        onRetry={retry}
      />
    );
  }

  const items = runners.data.pages.flatMap((page) => page.items);
  return (
    <div className="flex flex-col gap-4">
      {runners.isRefetchError && <StaleNotice onRetry={retry} />}
      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No runners yet</EmptyTitle>
            <EmptyDescription>
              Pair your first runner with the Pair a runner card above.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {items.map((runner) => (
            <li key={runner.id} className="min-w-0">
              <RunnerCard runner={runner} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={runners.hasNextPage}
        isFetchingNextPage={runners.isFetchingNextPage}
        nextPageError={runners.isFetchNextPageError ? runners.error : null}
        onLoadMore={() => void runners.fetchNextPage()}
      />
    </div>
  );
}
