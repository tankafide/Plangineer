import { useMe } from '@plangineer/api-client';
import type { MeGetOutput, UserRole } from '@plangineer/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { authClient } from '@/lib/auth-client';

const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', member: 'Member' };

function UserDetails({ user }: { user: MeGetOutput }) {
  return (
    <dl className="flex flex-col gap-3 text-sm">
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{user.name}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">Email</dt>
        <dd className="break-all">{user.email}</dd>
      </div>
      <div className="flex flex-col gap-0.5">
        <dt className="text-muted-foreground">Role</dt>
        <dd>{ROLE_LABELS[user.role]}</dd>
      </div>
    </dl>
  );
}

function LoadingDetails() {
  return (
    <output aria-label="Loading account" className="flex flex-col gap-3">
      <Skeleton className="h-10 w-2/3" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-1/3" />
    </output>
  );
}

function FailedDetails({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>Your account could not be loaded</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
      <Button variant="outline" className="w-full md:w-auto md:self-start" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function StaleNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert>
      <CircleAlert aria-hidden />
      <AlertTitle>Stale</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        These details could not be refreshed.
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/** The signed-in user's name, email and role, with sign out. */
export function AccountSummary() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const retry = () => void me.refetch();

  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: '/sign-in' });
  }

  return (
    <Card className="w-full max-w-[640px]">
      <CardHeader>
        <CardTitle>
          <h1>Your account</h1>
        </CardTitle>
        <CardDescription>Signed in with GitHub</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {me.isPending && <LoadingDetails />}
        {me.isError && me.data === undefined && (
          <FailedDetails message={me.error.message} onRetry={retry} />
        )}
        {me.isRefetchError && <StaleNotice onRetry={retry} />}
        {me.data !== undefined && <UserDetails user={me.data} />}
      </CardContent>
      <CardFooter>
        <Button variant="outline" className="w-full md:ml-auto md:w-auto" onClick={signOut}>
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}
