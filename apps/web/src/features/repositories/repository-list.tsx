import { useRepositoryList } from '@plangineer/api-client';
import type { RepositorySummary } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { LoadFailed } from '@/components/load-failed';
import { LoadMore } from '@/components/load-more';
import { StaleNotice } from '@/components/stale-notice';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { SetupStatusBadge } from './setup-status-badge';

function LoadingRepositories() {
  return (
    <output aria-label="Loading repositories" className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </output>
  );
}

function RepositoryRow({ repository }: { repository: RepositorySummary }) {
  return (
    <Item
      variant="outline"
      className="bg-card"
      render={<Link to="/repositories/$repositoryId" params={{ repositoryId: repository.id }} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 font-mono text-xs break-all">
            {repository.owner}/{repository.name}
          </span>
          <SetupStatusBadge status={repository.setupStatus} />
        </ItemTitle>
        <ItemDescription className="break-words">{repository.description}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

/** The team's repositories, newest first, each linking to its page. */
export function RepositoryList({ emptyHint }: { emptyHint: string }) {
  const repositories = useRepositoryList();
  const retry = () => void repositories.refetch();

  if (repositories.isPending) return <LoadingRepositories />;
  if (repositories.isError && repositories.data === undefined) {
    return (
      <LoadFailed
        title="Repositories could not be loaded"
        message={repositories.error.message}
        onRetry={retry}
      />
    );
  }

  const items = repositories.data.pages.flatMap((page) => page.items);
  return (
    <div className="flex flex-col gap-4">
      {repositories.isRefetchError && <StaleNotice onRetry={retry} />}
      {items.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>No repositories yet</EmptyTitle>
            <EmptyDescription>{emptyHint}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((repository) => (
            <li key={repository.id} className="min-w-0">
              <RepositoryRow repository={repository} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={repositories.hasNextPage}
        isFetchingNextPage={repositories.isFetchingNextPage}
        nextPageError={repositories.isFetchNextPageError ? repositories.error : null}
        onLoadMore={() => void repositories.fetchNextPage()}
      />
    </div>
  );
}
