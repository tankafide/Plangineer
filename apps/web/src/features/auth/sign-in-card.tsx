import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { authClient } from '@/lib/auth-client';

function signInWithGitHub() {
  return authClient.signIn.social({
    provider: 'github',
    callbackURL: '/',
    errorCallbackURL: '/sign-in',
  });
}

/** The sign-in card. failed is set when GitHub sent the user back with an error. */
export function SignInCard({ failed }: { failed: boolean }) {
  return (
    <Card className="w-full max-w-[400px]">
      <CardHeader>
        <CardTitle>
          <h1>Sign in to Plangineer</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {failed && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>GitHub sign-in did not complete. Try again.</AlertDescription>
          </Alert>
        )}
        <Button size="lg" className="w-full" onClick={signInWithGitHub}>
          Sign in with GitHub
        </Button>
      </CardContent>
    </Card>
  );
}
