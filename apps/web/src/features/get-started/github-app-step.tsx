import { useGithubAppManifest } from '@plangineer/api-client';
import type { InstanceStatus } from '@plangineer/contracts';
import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { postManifest } from './manifest-flow';
import { StepCard } from './step-card';
import type { GithubAppReturn } from './use-github-app-return';

const TITLE = 'Create the GitHub App';
const ACTION_CLASS = 'w-full md:w-auto md:self-start';
const CREATE_TEXT = 'Create the GitHub App on your GitHub account. GitHub asks you to confirm.';
const MISMATCH_TEXT = 'This link did not come from this setup. Start again.';

function ReadyApp({ slug }: { slug: string | null }) {
  return (
    <StepCard title={TITLE} done>
      <p>
        GitHub App <code className="font-mono text-xs break-all">{slug}</code> is ready.
      </p>
      <a
        href={`https://github.com/apps/${encodeURIComponent(slug ?? '')}`}
        target="_blank"
        rel="noreferrer"
        className={buttonVariants({ variant: 'outline', className: ACTION_CLASS })}
      >
        Open on GitHub
      </a>
    </StepCard>
  );
}

function CreateApp({
  setupToken,
  githubAppReturn,
  primary,
}: {
  setupToken: string;
  githubAppReturn: GithubAppReturn;
  primary: boolean;
}) {
  const manifest = useGithubAppManifest();
  // Posting the manifest leaves the page, so the button stays busy until it does.
  const [leaving, setLeaving] = useState(false);

  function create() {
    manifest.mutate(
      { setupToken },
      {
        onSuccess: (output) => {
          setLeaving(true);
          postManifest(output);
        },
      },
    );
  }

  const creating = manifest.isPending || leaving || githubAppReturn.pending;
  const failure = manifest.isError ? manifest.error.message : githubAppReturn.failure;
  const failed = !creating && failure !== null;
  const mismatched = !creating && !failed && githubAppReturn.mismatched;
  return (
    <StepCard title={TITLE} done={false}>
      {failed ? (
        <p role="alert" className="break-words text-destructive">
          {failure}
        </p>
      ) : (
        <p className="text-muted-foreground">{mismatched ? MISMATCH_TEXT : CREATE_TEXT}</p>
      )}
      <Button
        variant={primary ? 'default' : 'outline'}
        className={ACTION_CLASS}
        disabled={creating}
        aria-busy={creating}
        onClick={create}
      >
        {creating && (
          <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
        )}
        {failed ? 'Try again' : 'Create GitHub App'}
      </Button>
    </StepCard>
  );
}

/**
 * Step 1. The setup token's holder creates the App through GitHub's manifest flow, which leaves
 * this page and comes back with the code that githubAppReturn completes.
 */
export function GithubAppStep({
  status,
  setupToken,
  githubAppReturn,
  primary,
}: {
  status: InstanceStatus;
  setupToken: string | null;
  githubAppReturn: GithubAppReturn;
  primary: boolean;
}) {
  if (status.githubApp === 'configured') return <ReadyApp slug={status.githubAppSlug} />;
  if (setupToken === null) {
    return (
      <StepCard title={TITLE} done={false}>
        <p className="text-muted-foreground">
          Open this page from the link the Plangineer app or server gave you.
        </p>
      </StepCard>
    );
  }
  return <CreateApp setupToken={setupToken} githubAppReturn={githubAppReturn} primary={primary} />;
}
