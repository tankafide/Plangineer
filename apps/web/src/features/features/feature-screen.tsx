import { isApiError, useFeature, useUpdateFeature } from '@plangineer/api-client';
import type { FeatureDetail } from '@plangineer/contracts';
import { planOpen } from '@plangineer/domain';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { LoadFailed } from '@/components/load-failed';
import { StaleNotice } from '@/components/stale-notice';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { ContextFileList } from './context-file-list';
import { FeatureStateBadge } from './feature-state-badge';
import { RunModeField } from './run-mode-field';
import { StartPlanning } from './start-planning';
import { TaskList } from './task-list';

const COLUMNS = 'flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start';

function LoadingFeature() {
  return (
    <output aria-label="Loading feature" className="flex flex-col gap-4">
      <Skeleton className="h-56 w-full rounded-xl" />
      <div className={COLUMNS}>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    </output>
  );
}

function FeatureNotFound() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          <h1>Feature not found</h1>
        </EmptyTitle>
        <EmptyDescription>It does not exist, or it belongs to someone else.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/features" className={buttonVariants({ variant: 'outline' })}>
          Back to features
        </Link>
      </EmptyContent>
    </Empty>
  );
}

/** The run mode select. A change saves at once, and the select shows the mode being saved. */
function FeatureRunMode({ feature }: { feature: FeatureDetail }) {
  const update = useUpdateFeature();
  return (
    <div className="flex flex-col gap-3">
      <RunModeField
        id="feature-run-mode"
        label="Run mode"
        value={update.isPending ? update.variables.runMode : feature.runMode}
        disabled={update.isPending}
        onValueChange={(runMode) => update.mutate({ featureId: feature.id, runMode })}
      />
      {update.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>
            The run mode could not be changed: {update.error.message}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function FeatureHeaderCard({ feature }: { feature: FeatureDetail }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-xl font-semibold break-words">{feature.title}</h1>
          <FeatureStateBadge state={feature.state} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {feature.ticketUrl !== null && (
          <p className="flex min-w-0 flex-col gap-0.5">
            <span className="text-muted-foreground">Ticket</span>
            <a
              href={feature.ticketUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-link underline-offset-4 hover:underline"
            >
              {feature.ticketUrl}
            </a>
          </p>
        )}
        <FeatureRunMode feature={feature} />
        {planOpen(feature.state) ? (
          <Link
            to="/features/$featureId/plan"
            params={{ featureId: feature.id }}
            className={buttonVariants({ className: 'w-full md:w-auto md:self-start' })}
          >
            Open plan
          </Link>
        ) : (
          <StartPlanning feature={feature} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * One feature: its header with the run mode and Start planning or Open plan, its tasks and its
 * context files.
 */
export function FeatureScreen({ featureId }: { featureId: string }) {
  const feature = useFeature(featureId);
  const retry = () => void feature.refetch();

  if (feature.isPending) return <LoadingFeature />;
  if (feature.isError && feature.data === undefined) {
    if (isApiError(feature.error, 'NOT_FOUND')) return <FeatureNotFound />;
    return (
      <LoadFailed
        title="The feature could not be loaded"
        message={feature.error.message}
        onRetry={retry}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {feature.isRefetchError && <StaleNotice onRetry={retry} />}
      <FeatureHeaderCard feature={feature.data} />
      <div className={COLUMNS}>
        <TaskList tasks={feature.data.tasks} />
        <ContextFileList featureId={feature.data.id} files={feature.data.contextFiles} />
      </div>
    </div>
  );
}
