import {
  isApiError,
  useApproveRunnerLogin,
  useDenyRunnerLogin,
  useRunnerLogin,
} from '@plangineer/api-client';
import type { RunnerLogin } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { CircleCheck, CircleX } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { LoadFailed } from '@/components/load-failed';
import { StaleNotice } from '@/components/stale-notice';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/date-time';
import { PLATFORM_LABELS } from './platform-labels';

const CARD_WIDTH = 'w-full md:mx-auto md:max-w-md';
const DECISION_BUTTON = 'min-h-11 w-full md:w-auto';

function LoadingLogin() {
  return (
    <output aria-label="Loading pairing request" className={CARD_WIDTH}>
      <Skeleton className="h-64 w-full rounded-xl" />
    </output>
  );
}

function ResultCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className={CARD_WIDTH}>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function ExpiredLogin() {
  return (
    <ResultCard title="Pairing request not found">
      <p>
        This pairing request expired or was already used. Run{' '}
        <code className="font-mono">plangineer-runner login</code> again.
      </p>
    </ResultCard>
  );
}

function ApprovedLogin() {
  return (
    <ResultCard title="Runner approved">
      <p className="flex items-start gap-2">
        <CircleCheck aria-hidden className="mt-0.5 shrink-0 text-success" />
        Approved. Your terminal finishes pairing on its own.
      </p>
      <Link to="/runners" className={buttonVariants({ variant: 'outline' })}>
        Go to Runners
      </Link>
    </ResultCard>
  );
}

function DeniedLogin() {
  return (
    <ResultCard title="Runner denied">
      <p className="flex items-start gap-2">
        <CircleX aria-hidden className="mt-0.5 shrink-0 text-muted-foreground" />
        Denied. Nothing was paired.
      </p>
    </ResultCard>
  );
}

function decisionFailure(error: Error): string {
  return isApiError(error, 'CONFLICT')
    ? 'This request was already decided. Reload to see its state.'
    : 'Could not reach Plangineer. Try again.';
}

function DecisionError({ error }: { error: Error | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {decisionFailure(error)}
    </p>
  );
}

function PendingLogin({
  login,
  userCode,
  onExpired,
}: {
  login: RunnerLogin;
  userCode: string;
  onExpired: () => void;
}) {
  const approve = useApproveRunnerLogin();
  const deny = useDenyRunnerLogin();
  const busy = approve.isPending || deny.isPending;

  function decide(mutation: typeof approve) {
    mutation.mutate(
      { userCode },
      { onError: (error) => isApiError(error, 'NOT_FOUND') && onExpired() },
    );
  }

  return (
    <Card className={CARD_WIDTH}>
      <CardHeader>
        <CardTitle>
          <h1 className="break-all">Pair {login.name}?</h1>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Platform</dt>
          <dd>{PLATFORM_LABELS[login.platform]}</dd>
          <dt className="text-muted-foreground">Requested</dt>
          <dd>{formatDateTime(login.requestedAt)}</dd>
          <dt className="text-muted-foreground">Code</dt>
          <dd className="font-mono text-2xl tracking-widest">{userCode}</dd>
        </dl>
        <p className="text-muted-foreground">
          Approve only if you just ran <code className="font-mono">plangineer-runner login</code>{' '}
          and your terminal shows this code.
        </p>
        <div className="flex flex-col gap-2 md:flex-row md:items-start">
          <div className="flex flex-col gap-2">
            <Button className={DECISION_BUTTON} disabled={busy} onClick={() => decide(approve)}>
              {approve.isPending ? 'Approving…' : 'Approve'}
            </Button>
            <DecisionError error={approve.error} />
          </div>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className={DECISION_BUTTON}
              disabled={busy}
              onClick={() => decide(deny)}
            >
              {deny.isPending ? 'Denying…' : 'Deny'}
            </Button>
            <DecisionError error={deny.error} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/** A runner's pairing request, loaded by the user code in the approval link. */
export function ApproveRunnerScreen({ userCode }: { userCode: string | undefined }) {
  const login = useRunnerLogin(userCode);
  const [expired, setExpired] = useState(false);

  if (userCode === undefined || expired) return <ExpiredLogin />;
  if (login.isPending) return <LoadingLogin />;
  if (login.isError && login.data === undefined) {
    if (isApiError(login.error, 'NOT_FOUND')) return <ExpiredLogin />;
    return (
      <div className={CARD_WIDTH}>
        <LoadFailed
          title="The pairing request could not be loaded"
          message={login.error.message}
          onRetry={() => void login.refetch()}
        />
      </div>
    );
  }

  const { data } = login;
  return (
    <div className="flex flex-col gap-4">
      {login.isRefetchError && (
        <div className={CARD_WIDTH}>
          <StaleNotice onRetry={() => void login.refetch()} />
        </div>
      )}
      {data.status === 'approved' && <ApprovedLogin />}
      {data.status === 'denied' && <DeniedLogin />}
      {data.status === 'pending' && (
        <PendingLogin login={data} userCode={userCode} onExpired={() => setExpired(true)} />
      )}
    </div>
  );
}
