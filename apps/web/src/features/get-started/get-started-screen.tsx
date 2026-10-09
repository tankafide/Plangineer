import { useInstanceStatus, useSetupRepositories, useSetupRunners } from '@plangineer/api-client';
import type { InstanceStatus } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useSession } from '@/lib/auth-client';
import { ClaudeCodeStep } from './claude-code-step';
import { GithubAppStep } from './github-app-step';
import { RepositoryStep } from './repository-step';
import { claudeCodeProgress } from './setup-progress';
import { readSetupToken } from './setup-token';
import { SignInStep } from './sign-in-step';
import { StepFailed } from './step-failed';
import { type GithubAppReturn, useGithubAppReturn } from './use-github-app-return';

const STEP_COUNT = 4;

function LoadingSteps() {
  return (
    <output aria-label="Loading setup" className="flex flex-col gap-4">
      {Array.from({ length: STEP_COUNT }, (_, index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-5 w-full" />
          </CardContent>
        </Card>
      ))}
    </output>
  );
}

/** The four steps, with the button of the first step not done as the one primary button. */
function SetupSteps({
  status,
  setupToken,
  githubAppReturn,
}: {
  status: InstanceStatus;
  setupToken: string | null;
  githubAppReturn: GithubAppReturn;
}) {
  const session = useSession();
  const appReady = status.githubApp === 'configured';
  const signedIn = appReady && session.data != null;
  const runners = useSetupRunners(signedIn);
  const repositories = useSetupRepositories(signedIn);
  const progress = runners.data === undefined ? null : claudeCodeProgress(runners.data.items);

  const done = [
    appReady,
    signedIn,
    signedIn && progress?.state === 'done',
    signedIn && (repositories.data?.items.length ?? 0) > 0,
  ];
  const firstOpen = done.indexOf(false);
  return (
    <>
      <GithubAppStep
        status={status}
        setupToken={setupToken}
        githubAppReturn={githubAppReturn}
        primary={firstOpen === 0}
      />
      <SignInStep appReady={appReady} session={session} primary={firstOpen === 1} />
      <ClaudeCodeStep
        signedIn={signedIn}
        runners={runners}
        progress={progress}
        primary={firstOpen === 2}
      />
      <RepositoryStep signedIn={signedIn} repositories={repositories} primary={firstOpen === 3} />
      {firstOpen === -1 && (
        <Link to="/" className={buttonVariants({ className: 'w-full md:w-auto md:self-start' })}>
          Open Plangineer
        </Link>
      )}
    </>
  );
}

/**
 * The public setup checklist: create the GitHub App, sign in, get Claude Code on a runner and add
 * a repository. code and state are what GitHub's redirect after creating the App carries.
 */
export function GetStartedScreen({
  code,
  state,
}: {
  code: string | undefined;
  state: string | undefined;
}) {
  const [setupToken] = useState(readSetupToken);
  const githubAppReturn = useGithubAppReturn({ code, state, setupToken });
  const status = useInstanceStatus();

  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-4 px-4 py-6 md:py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">Get started</h1>
        {status.isRefetchError && (
          <p className="flex items-center gap-2 text-warning">
            <CircleAlert aria-hidden className="size-4" />
            Reconnecting
          </p>
        )}
      </div>
      {status.data !== undefined ? (
        <SetupSteps
          status={status.data}
          setupToken={setupToken}
          githubAppReturn={githubAppReturn}
        />
      ) : status.isError ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <StepFailed
              title="Setup could not be loaded"
              message={status.error.message}
              onRetry={() => void status.refetch()}
            />
          </CardContent>
        </Card>
      ) : (
        <LoadingSteps />
      )}
    </div>
  );
}
