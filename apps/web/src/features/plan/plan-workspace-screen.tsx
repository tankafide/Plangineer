import { isApiError, useFeature, usePlan, usePlanTurnEvents } from '@plangineer/api-client';
import type { PlanBody, PlanSection, PlanWorkspace, RunEvent } from '@plangineer/contracts';
import { openQuestions, planOpen } from '@plangineer/domain';
import { Link } from '@tanstack/react-router';
import { LoadFailed } from '@/components/load-failed';
import { StaleNotice } from '@/components/stale-notice';
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
import { CoverageGrid } from './coverage-grid';
import { PlanHeaderCard } from './plan-header-card';
import { PLAN_CONFLICT_MESSAGES } from './plan-labels';
import { QuestionCard } from './question-card';
import { ReadinessChecklist } from './readiness-checklist';
import { SectionCard } from './section-card';
import { SectionRail } from './section-rail';
import { DecisionList, SectionBlockers, SectionView } from './section-views';
import { StepList } from './step-list';
import { isTurnRunning, TurnStatus } from './turn-status';

function LoadingPlan() {
  return (
    <output aria-label="Loading plan" className="flex flex-col gap-4">
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </output>
  );
}

function PlanNotFound() {
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

function PlanLoadFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  if (isApiError(error, 'NOT_FOUND')) return <PlanNotFound />;
  return (
    <LoadFailed title="The plan could not be loaded" message={error.message} onRetry={onRetry} />
  );
}

function PlanningNotStarted({ featureId }: { featureId: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>
          <h1>Planning has not started</h1>
        </EmptyTitle>
        <EmptyDescription>The plan opens once the feature is in planning.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link
          to="/features/$featureId"
          params={{ featureId }}
          className={buttonVariants({ variant: 'outline' })}
        >
          Back to the feature
        </Link>
      </EmptyContent>
    </Empty>
  );
}

function SectionContent({
  section,
  featureId,
  revision,
  body,
  blockedReason,
}: {
  section: PlanSection;
  featureId: string;
  revision: number;
  body: PlanBody;
  blockedReason: string | null;
}) {
  if (section === 'steps') {
    return (
      <StepList
        featureId={featureId}
        revision={revision}
        body={body}
        blockedReason={blockedReason}
      />
    );
  }
  if (section === 'test_plan') {
    // Unsaved ticks belong to the revision they were made on, so a newer one starts clean.
    return (
      <CoverageGrid
        key={revision}
        featureId={featureId}
        body={body}
        blockedReason={blockedReason}
      />
    );
  }
  return <SectionView section={section} body={body} />;
}

/** The plan once drafted: the checklist and rail beside one card per section. */
function DraftedPlan({
  workspace,
  revision,
  blockedReason,
}: {
  workspace: PlanWorkspace;
  revision: NonNullable<PlanWorkspace['revision']>;
  blockedReason: string | null;
}) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[16rem_minmax(0,1fr)] lg:items-start">
      <div className="flex flex-col gap-4 lg:sticky lg:top-4">
        <ReadinessChecklist items={workspace.readiness} />
        <div className="lg:order-first">
          <SectionRail sections={workspace.sections} />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {workspace.sections.map(({ section }) => (
          <SectionCard
            key={section}
            featureId={workspace.featureId}
            revision={revision.number}
            section={section}
            blockedReason={blockedReason}
          >
            <SectionBlockers
              blockers={revision.body.blockers.filter((blocker) => blocker.section === section)}
            />
            <SectionContent
              section={section}
              featureId={workspace.featureId}
              revision={revision.number}
              body={revision.body}
              blockedReason={blockedReason}
            />
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

/** Before the first draft: the decisions so far, and where the plan will appear. */
function AwaitingDraft({ workspace }: { workspace: PlanWorkspace }) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold">Decisions</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DecisionList decisions={workspace.decisions} />
        </CardContent>
      </Card>
      <Empty className="border">
        <EmptyHeader>
          <EmptyTitle>No plan yet</EmptyTitle>
          <EmptyDescription>The plan appears here once the agent drafts it.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    </>
  );
}

function lastAgentMessage(events: readonly RunEvent[]): string | null {
  const message = events.findLast((event) => event.type === 'agent.message');
  return message?.type === 'agent.message' ? message.text : null;
}

/** A feature's plan workspace: the agent's turn, its questions, and the plan to edit. */
export function PlanWorkspaceScreen({ featureId }: { featureId: string }) {
  const plan = usePlan(featureId);
  const feature = useFeature(featureId);
  const turnEvents = usePlanTurnEvents(plan.data);
  const refetch = () => {
    void plan.refetch();
    void feature.refetch();
  };

  if (plan.isPending || feature.isPending) return <LoadingPlan />;
  if (plan.isError && plan.data === undefined) {
    return <PlanLoadFailed error={plan.error} onRetry={refetch} />;
  }
  if (feature.isError && feature.data === undefined) {
    return <PlanLoadFailed error={feature.error} onRetry={refetch} />;
  }
  const workspace = plan.data;
  if (!planOpen(workspace.featureState)) return <PlanningNotStarted featureId={featureId} />;

  const streamStale = ['reconnecting', 'failed'].includes(turnEvents.state.status);
  let blockedReason: string | null = null;
  if (isTurnRunning(workspace.turn)) blockedReason = PLAN_CONFLICT_MESSAGES.turn_running;
  else if (openQuestions(workspace.questions).length > 0)
    blockedReason = PLAN_CONFLICT_MESSAGES.questions_open;

  return (
    <div className="flex flex-col gap-4">
      {(plan.isRefetchError || feature.isRefetchError || streamStale) && (
        <StaleNotice
          onRetry={() => {
            refetch();
            if (streamStale) turnEvents.retry();
          }}
        />
      )}
      <PlanHeaderCard
        title={feature.data.title}
        workspace={workspace}
        blockedReason={blockedReason}
      />
      <TurnStatus
        featureId={featureId}
        turn={workspace.turn}
        lastMessage={lastAgentMessage(turnEvents.events)}
      />
      <QuestionCard questions={workspace.questions} />
      {workspace.revision === null ? (
        <AwaitingDraft workspace={workspace} />
      ) : (
        <DraftedPlan
          workspace={workspace}
          revision={workspace.revision}
          blockedReason={blockedReason}
        />
      )}
    </div>
  );
}
