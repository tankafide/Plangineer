import { CircleAlert } from 'lucide-react';
import { useState, useTransition } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { signInWithGitHub } from '@/lib/auth-client';

/** The sign-in card. failed is set when GitHub sent the user back with an error. */
export function SignInCard({ failed }: { failed: boolean }) {
  const [pending, startTransition] = useTransition();
  const [startFailed, setStartFailed] = useState(false);

  function signIn() {
    setStartFailed(false);
    startTransition(async () => {
      try {
        await signInWithGitHub();
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
        <Button size="lg" className="w-full" disabled={pending} onClick={signIn}>
          {pending ? 'Signing in…' : 'Sign in with GitHub'}
        </Button>
      </CardContent>
    </Card>
  );
}
