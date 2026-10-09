import { useSetupRepositories, useSetupRunners } from '@plangineer/api-client';
import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { claudeCodeProgress } from './setup-progress';
import { StepFailed } from './step-failed';

const HEADING = 'Finish setting up Plangineer';

/**
 * The home page's nudge to /get-started while Claude Code is not ready or no repository is added.
 * It shows nothing while it loads and once both are done, since it only points elsewhere.
 */
export function GetStartedCard() {
  const runners = useSetupRunners(true);
  const repositories = useSetupRepositories(true);

  const failure =
    (runners.data === undefined ? runners.error : null) ??
    (repositories.data === undefined ? repositories.error : null);
  if (failure !== null) {
    const retry = () => {
      if (runners.isError) void runners.refetch();
      if (repositories.isError) void repositories.refetch();
    };
    return (
      <Card className="w-full max-w-[640px]">
        <CardHeader>
          <CardTitle>
            <h2>{HEADING}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StepFailed
            title="Setup progress could not be loaded"
            message={failure.message}
            onRetry={retry}
          />
        </CardContent>
      </Card>
    );
  }
  if (runners.data === undefined || repositories.data === undefined) return null;
  const claudeCodeReady = claudeCodeProgress(runners.data.items).state === 'done';
  if (claudeCodeReady && repositories.data.items.length > 0) return null;
  return (
    <Card className="w-full max-w-[640px]">
      <CardHeader>
        <CardTitle>
          <h2>{HEADING}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Link to="/get-started" className={buttonVariants({ className: 'w-full md:w-auto' })}>
          Get started
        </Link>
      </CardContent>
    </Card>
  );
}
