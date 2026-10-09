import { useMe, type useSetupRepositories } from '@plangineer/api-client';
import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { StepCard } from './step-card';
import { StepFailed } from './step-failed';
import { StepLoading } from './step-loading';

const TITLE = 'Add a repository';

type Repositories = ReturnType<typeof useSetupRepositories>;

/** No repository yet: an admin adds one, and a member waits for an admin. */
function AddRepository({ primary }: { primary: boolean }) {
  const me = useMe();
  if (me.data !== undefined) {
    return me.data.role === 'admin' ? (
      <>
        <p className="text-muted-foreground">Add the first repository agents work in.</p>
        <Link
          to="/repositories"
          className={buttonVariants({
            variant: primary ? 'default' : 'outline',
            className: 'w-full md:w-auto md:self-start',
          })}
        >
          Add repository
        </Link>
      </>
    ) : (
      <p className="text-muted-foreground">An admin adds repositories.</p>
    );
  }
  return me.isError ? (
    <StepFailed
      title="Your role could not be loaded"
      message={me.error.message}
      onRetry={() => void me.refetch()}
    />
  ) : (
    <StepLoading label="Loading your role" />
  );
}

/** Step 4. Done once any repository is added. */
export function RepositoryStep({
  signedIn,
  repositories,
  primary,
}: {
  signedIn: boolean;
  repositories: Repositories;
  primary: boolean;
}) {
  if (!signedIn) {
    return (
      <StepCard title={TITLE} done={false}>
        <p className="text-muted-foreground">Add a repository once you sign in.</p>
      </StepCard>
    );
  }
  const added = repositories.data?.items[0];
  if (added !== undefined) {
    return (
      <StepCard title={TITLE} done>
        <p>
          <span className="font-mono text-xs break-all">
            {added.owner}/{added.name}
          </span>{' '}
          added.
        </p>
      </StepCard>
    );
  }
  return (
    <StepCard title={TITLE} done={false}>
      {repositories.data !== undefined ? (
        <AddRepository primary={primary} />
      ) : repositories.isError ? (
        <StepFailed
          title="Your repositories could not be loaded"
          message={repositories.error.message}
          onRetry={() => void repositories.refetch()}
        />
      ) : (
        <StepLoading label="Loading your repositories" />
      )}
    </StepCard>
  );
}
