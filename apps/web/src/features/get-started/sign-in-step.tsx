import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import type { useSession } from '@/lib/auth-client';
import { StepCard } from './step-card';
import { StepFailed } from './step-failed';
import { StepLoading } from './step-loading';

const TITLE = 'Sign in';

type Session = ReturnType<typeof useSession>;

/** Step 2. Sign-in needs the GitHub App, so it waits for step 1. */
export function SignInStep({
  appReady,
  session,
  primary,
}: {
  appReady: boolean;
  session: Session;
  primary: boolean;
}) {
  if (!appReady) {
    return (
      <StepCard title={TITLE} done={false}>
        <p className="text-muted-foreground">Sign in once the GitHub App is ready.</p>
      </StepCard>
    );
  }
  if (session.data != null) {
    return (
      <StepCard title={TITLE} done>
        <p>Signed in as {session.data.user.name}.</p>
      </StepCard>
    );
  }
  return (
    <StepCard title={TITLE} done={false}>
      {session.isError ? (
        <StepFailed
          title="Your session could not be loaded"
          message={session.error.message}
          onRetry={() => void session.refetch()}
        />
      ) : session.isPending ? (
        <StepLoading label="Loading your session" />
      ) : (
        <>
          <p className="text-muted-foreground">Sign in with the GitHub account you work with.</p>
          <Link
            to="/sign-in"
            search={{ redirect: '/get-started' }}
            className={buttonVariants({
              variant: primary ? 'default' : 'outline',
              className: 'w-full md:w-auto md:self-start',
            })}
          >
            Sign in with GitHub
          </Link>
        </>
      )}
    </StepCard>
  );
}
