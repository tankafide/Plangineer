import { useRepositoryList } from '@plangineer/api-client';
import { Link } from '@tanstack/react-router';
import { useEffect } from 'react';
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
import { cn } from '@/lib/cn';
import { IntakeForm } from './intake-form';

const CARD_WIDTH = 'w-full max-w-2xl';

/** Every configured repository. The form needs them all, so it loads the pages in turn. */
function useAllRepositories() {
  const repositories = useRepositoryList();
  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = repositories;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);
  return repositories;
}

function LoadingIntake() {
  return (
    <output aria-label="Loading repositories" className={CARD_WIDTH}>
      <Skeleton className="h-144 w-full rounded-xl" />
    </output>
  );
}

function NoRepositories() {
  return (
    <Empty className={cn('border', CARD_WIDTH)}>
      <EmptyHeader>
        <EmptyTitle>No repositories yet</EmptyTitle>
        <EmptyDescription>Add a repository before starting a feature.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/repositories" className={buttonVariants({ variant: 'outline' })}>
          Go to Repositories
        </Link>
      </EmptyContent>
    </Empty>
  );
}

function IntakeBody() {
  const repositories = useAllRepositories();
  const retry = () => void repositories.refetch();

  if (repositories.isPending) return <LoadingIntake />;
  const loadFailed =
    repositories.isError && (repositories.data === undefined || repositories.isFetchNextPageError);
  if (loadFailed) {
    return (
      <LoadFailed
        title="Repositories could not be loaded"
        message={repositories.error.message}
        onRetry={retry}
      />
    );
  }
  if (repositories.hasNextPage) return <LoadingIntake />;

  const items = repositories.data.pages.flatMap((page) => page.items);
  return (
    <>
      {repositories.isRefetchError && <StaleNotice onRetry={retry} />}
      {items.length === 0 ? <NoRepositories /> : <IntakeForm repositories={items} />}
    </>
  );
}

/** The New feature screen: the intake form, once every repository has loaded. */
export function IntakeScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New feature</h1>
      <IntakeBody />
    </div>
  );
}
