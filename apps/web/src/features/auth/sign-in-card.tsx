import { useInstanceStatus } from '@plangineer/api-client';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { signInWithGitHub } from '@/lib/auth-client';

/** Sign-in needs the GitHub App, so before it exists the card points to /get-started. */
function SignInAction({ pending, onSignIn }: { pending: boolean; onSignIn: () => void }) {
  const status = useInstanceStatus();
  if (status.data?.githubApp === 'configured') {
    return (
      <Button size="lg" className="w-full" disabled={pending} onClick={onSignIn}>
        {pending ? 'Signing in…' : 'Sign in with GitHub'}
      </Button>
    );
  }
  if (status.data !== undefined) {
    return (
      <>
        <p className="text-muted-foreground">Plangineer is not set up yet.</p>
        <Link to="/get-started" className={buttonVariants({ size: 'lg', className: 'w-full' })}>
          Get started
        </Link>
      </>
    );
  }
  if (status.isError) {
    return (
      <>
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertTitle>Plangineer could not be reached</AlertTitle>
          <AlertDescription className="break-words">{status.error.message}</AlertDescription>
        </Alert>
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          onClick={() => void status.refetch()}
        >
          Try again
        </Button>
      </>
    );
  }
  return (
    <output aria-label="Loading sign-in" className="block">
      <Skeleton className="h-11 w-full md:h-9" />
    </output>
  );
}

/**
 * The sign-in card. failed is set when GitHub sent the user back with an error, and redirect is
 * the same-origin path to return to after sign-in.
 */
export function SignInCard({ failed, redirect }: { failed: boolean; redirect: string }) {
  const [pending, startTransition] = useTransition();
  const [startFailed, setStartFailed] = useState(false);

  function signIn() {
    setStartFailed(false);
    startTransition(async () => {
      try {
        await signInWithGitHub(redirect);
      } catch {
        setStartFailed(true);
      }
    });
  }

  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader>
        <CardTitle>
          <h1>Sign in to Plangineer</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {(failed || startFailed) && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>GitHub sign-in did not complete. Try again.</AlertDescription>
          </Alert>
        )}
        <SignInAction pending={pending} onSignIn={signIn} />
      </CardContent>
    </Card>
  );
}
