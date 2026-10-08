import { isApiError, useMe, useRepository } from '@plangineer/api-client';
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
import { RepositorySettingsCard } from './repository-settings-card';
import { SetupCard } from './setup-card';

const PAGE_LAYOUT = 'flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start';

function LoadingRepository() {
  return (
    <output aria-label="Loading repository" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-48" />
      <div className={PAGE_LAYOUT}>
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    </output>
  );
}

function RepositoryNotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          <h1>Repository not found</h1>
        </EmptyTitle>
        <EmptyDescription>It does not exist, or it was removed.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/repositories" className={buttonVariants({ variant: 'outline' })}>
          Back to repositories
        </Link>
      </EmptyContent>
    </Empty>
  );
}

/** One repository: its setup, then its settings. Members see both read-only. */
export function RepositoryScreen({ repositoryId }: { repositoryId: string }) {
  const repository = useRepository(repositoryId);
  const me = useMe();
  const retry = () => {
    if (repository.isError) void repository.refetch();
    if (me.isError) void me.refetch();
  };

  if (repository.isPending || me.isPending) return <LoadingRepository />;
  if (repository.isError && repository.data === undefined) {
    if (isApiError(repository.error, 'NOT_FOUND')) return <RepositoryNotFound />;
    return (
      <LoadFailed
        title="The repository could not be loaded"
        message={repository.error.message}
        onRetry={retry}
      />
    );
  }
  if (me.isError && me.data === undefined) {
    return (
      <LoadFailed
        title="Your role could not be loaded"
        message={me.error.message}
        onRetry={retry}
      />
    );
  }

  const isAdmin = me.data.role === 'admin';
  return (
    <div className="flex flex-col gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="font-mono text-xl font-semibold break-all">
          {repository.data.owner}/{repository.data.name}
        </h1>
        <p className="break-words text-muted-foreground">{repository.data.description}</p>
      </div>
      {repository.isRefetchError && <StaleNotice onRetry={retry} />}
      <div className={PAGE_LAYOUT}>
        <div className="min-w-0">
          <SetupCard repository={repository.data} isAdmin={isAdmin} />
        </div>
        <div className="min-w-0">
          <RepositorySettingsCard repository={repository.data} isAdmin={isAdmin} />
        </div>
      </div>
    </div>
  );
}
