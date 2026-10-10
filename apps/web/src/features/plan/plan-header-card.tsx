import { useContinuePlanning, useMarkReady } from '@plangineer/api-client';
import type { PlanWorkspace } from '@plangineer/contracts';
import { isReady } from '@plangineer/domain';
import { Link } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FeatureStateBadge } from '@/features/features/feature-state-badge';
import { PlanActionError } from './plan-action-error';
import { isTurnRunning } from './turn-status';

/**
 * The header's one primary action: Mark ready for a ready plan, Continue planning for a draft
 * that is not ready yet, and none while the agent works or before the first draft.
 */
function PrimaryAction({
  workspace,
  blockedReason,
}: {
  workspace: PlanWorkspace;
  blockedReason: string | null;
}) {
  const markReady = useMarkReady();
  const continuePlanning = useContinuePlanning();
  const { featureId, revision } = workspace;
  if (revision === null || isTurnRunning(workspace.turn)) return null;
  const ready = isReady(workspace.readiness);
  if (ready && workspace.featureState === 'ready_for_review') return null;
  const action = ready ? markReady : continuePlanning;
  const send = ready
    ? () => markReady.mutate({ featureId, revision: revision.number })
    : () => continuePlanning.mutate({ featureId });

  return (
    <div className="flex flex-col gap-3">
      {!ready && workspace.runMode === 'auto_loop' && workspace.autoLoopStopped && (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <AlertDescription>Auto loop stopped after 3 drafts that were not ready.</AlertDescription>
        </Alert>
      )}
      {action.isError && <PlanActionError error={action.error} onRetry={send} />}
      <Button
        className="w-full md:w-auto md:self-start"
        disabled={blockedReason !== null || action.isPending}
        onClick={send}
      >
        {ready ? 'Mark ready' : 'Continue planning'}
      </Button>
      {blockedReason !== null && <p className="text-muted-foreground">{blockedReason}</p>}
    </div>
  );
}

/**
 * The plan's header: the feature title, its state, the revision with a link to the history, and
 * the one primary action.
 */
export function PlanHeaderCard({
  title,
  workspace,
  blockedReason,
}: {
  title: string;
  workspace: PlanWorkspace;
  blockedReason: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-xl font-semibold break-words">{title}</h1>
          <FeatureStateBadge state={workspace.featureState} />
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-muted-foreground">
            {workspace.revision === null
              ? 'No draft yet.'
              : `Revision ${workspace.revision.number}`}
          </p>
          <Link
            to="/features/$featureId/plan/revisions"
            params={{ featureId: workspace.featureId }}
            search={{}}
            className={buttonVariants({ variant: 'ghost' })}
          >
            Revision history
          </Link>
        </div>
        <PrimaryAction workspace={workspace} blockedReason={blockedReason} />
      </CardContent>
    </Card>
  );
}
