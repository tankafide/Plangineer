import { useMe } from '@plangineer/api-client';
import { LoadFailed } from '@/components/load-failed';
import { Skeleton } from '@/components/ui/skeleton';
import { AddRepositoryCard } from './add-repository-card';
import { RepositoryList } from './repository-list';

const ADD_CARD_PLACE = 'min-w-0 lg:col-start-2 lg:row-start-1';

/** The add card for admins. Members see nothing here, since only admins add repositories. */
function AdminAddCard() {
  const me = useMe();
  if (me.isPending) {
    return (
      <output aria-label="Loading your role" className={ADD_CARD_PLACE}>
        <Skeleton className="h-64 w-full rounded-xl" />
      </output>
    );
  }
  if (me.isError && me.data === undefined) {
    return (
      <div className={ADD_CARD_PLACE}>
        <LoadFailed
          title="Your role could not be loaded"
          message={me.error.message}
          onRetry={() => void me.refetch()}
        />
      </div>
    );
  }
  if (me.data.role !== 'admin') return null;
  return (
    <div className={ADD_CARD_PLACE}>
      <AddRepositoryCard />
    </div>
  );
}

/** The Repositories screen: every repository the team set up, and the add card for admins. */
export function RepositoriesScreen() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Repositories</h1>
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <AdminAddCard />
        <section
          aria-labelledby="team-repositories"
          className="flex min-w-0 flex-col gap-3 lg:col-start-1 lg:row-start-1"
        >
          <h2 id="team-repositories" className="text-base font-semibold">
            Team repositories
          </h2>
          <RepositoryList emptyHint="An admin adds each repository Plangineer works on." />
        </section>
      </div>
    </div>
  );
}
