import type { useSetupRunners } from '@plangineer/api-client';
import { CopyButton } from '@/components/copy-button';
import { buttonVariants } from '@/components/ui/button';
import { runnerLoginCommand } from '@/features/runners/runner-login-command';
import { type ClaudeCodeProgress, isDesktopApp } from './setup-progress';
import { StepCard } from './step-card';
import { StepFailed } from './step-failed';
import { StepLoading } from './step-loading';

const TITLE = 'Claude Code';
const INSTALL_URL = 'https://code.claude.com/docs/en/setup';

type Runners = ReturnType<typeof useSetupRunners>;

function NoRunner({ primary }: { primary: boolean }) {
  if (isDesktopApp()) {
    return <p className="text-muted-foreground">Connecting this computer's runner.</p>;
  }
  const command = runnerLoginCommand();
  return (
    <>
      <p className="text-muted-foreground">
        Run this on your machine, then approve the request it opens in your browser.
      </p>
      <pre className="rounded-lg border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
        {command}
      </pre>
      <div>
        <CopyButton value={command} label="Copy command" primary={primary} />
      </div>
    </>
  );
}

function Progress({ progress, primary }: { progress: ClaudeCodeProgress; primary: boolean }) {
  if (progress.state === 'no-runner') return <NoRunner primary={primary} />;
  if (progress.state === 'done') {
    return (
      <p>
        Claude Code {progress.version} on {progress.runner}.
      </p>
    );
  }
  if (progress.state === 'offline') {
    return <p className="text-muted-foreground">{progress.runner} is offline.</p>;
  }
  return (
    <>
      <p className="text-muted-foreground">
        Install Claude Code on {progress.runner}, then run{' '}
        <code className="font-mono text-xs">claude</code> once in a terminal to sign in.
      </p>
      <a
        href={INSTALL_URL}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({
          variant: primary ? 'default' : 'outline',
          className: 'w-full md:w-auto md:self-start',
        })}
      >
        Install Claude Code
      </a>
    </>
  );
}

/** Step 3. The signed-in user's runners, read every 5 s, until one has Claude Code ready. */
export function ClaudeCodeStep({
  signedIn,
  runners,
  progress,
  primary,
}: {
  signedIn: boolean;
  runners: Runners;
  progress: ClaudeCodeProgress | null;
  primary: boolean;
}) {
  if (!signedIn) {
    return (
      <StepCard title={TITLE} done={false}>
        <p className="text-muted-foreground">Check Claude Code once you sign in.</p>
      </StepCard>
    );
  }
  return (
    <StepCard title={TITLE} done={progress?.state === 'done'}>
      {progress !== null ? (
        <Progress progress={progress} primary={primary} />
      ) : runners.isError ? (
        <StepFailed
          title="Your runners could not be loaded"
          message={runners.error.message}
          onRetry={() => void runners.refetch()}
        />
      ) : (
        <StepLoading label="Loading your runners" />
      )}
    </StepCard>
  );
}
