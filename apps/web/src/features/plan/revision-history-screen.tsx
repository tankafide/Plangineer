import { isApiError, usePlanRevision, usePlanRevisions } from '@plangineer/api-client';
import type { PlanRevisionSummary } from '@plangineer/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { useSyncExternalStore } from 'react';
import { LoadFailed } from '@/components/load-failed';
import { LoadMore } from '@/components/load-more';
import { StaleNotice } from '@/components/stale-notice';
import { buttonVariants } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldTitle } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/date-time';
import { REVISION_SOURCE_LABELS } from './plan-labels';
import { RevisionDiff } from './revision-diff';

/** Tailwind's md breakpoint, from which the diff shows side by side. */
const WIDE_SCREEN = '(min-width: 48rem)';

function subscribeToWidth(onChange: () => void) {
  const query = window.matchMedia(WIDE_SCREEN);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const isWideScreen = () => window.matchMedia(WIDE_SCREEN).matches;

function BackToPlan({ featureId }: { featureId: string }) {
  return (
    <Link
      to="/features/$featureId/plan"
      params={{ featureId }}
      className={buttonVariants({ variant: 'outline', className: 'self-start' })}
    >
      Back
    </Link>
  );
}

/** Fewer than two revisions: nothing to compare yet. Back, above, returns to the plan. */
function NothingToCompare({ title }: { title: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>Revisions to compare appear here as the plan changes.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

const revisionLabel = (revision: PlanRevisionSummary) =>
  `Revision ${revision.number} · ${REVISION_SOURCE_LABELS[revision.source]} · ${formatDateTime(revision.createdAt)}`;

function RevisionPicker({
  id,
  label,
  revisions,
  value,
  onPick,
}: {
  id: string;
  label: string;
  revisions: readonly PlanRevisionSummary[];
  value: number;
  onPick: (number: number) => void;
}) {
  const items = revisions.map((revision) => ({
    value: revision.number,
    label: revisionLabel(revision),
  }));
  return (
    <Field className="min-w-0">
      <FieldTitle id={`${id}-label`}>{label}</FieldTitle>
      <Select
        items={items}
        value={value}
        onValueChange={(number) => {
          if (number !== null) onPick(number);
        }}
      >
        <SelectTrigger className="w-full min-w-0" aria-labelledby={`${id}-label`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function DiffFailed({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <LoadFailed
      title="The revisions could not be loaded"
      message={error.message}
      onRetry={onRetry}
    />
  );
}

/** The diff of the two picked revisions, each loaded once and kept, since revisions never change. */
function PickedDiff({ featureId, from, to }: { featureId: string; from: number; to: number }) {
  const fromRevision = usePlanRevision(featureId, from);
  const toRevision = usePlanRevision(featureId, to);
  const wide = useSyncExternalStore(subscribeToWidth, isWideScreen);

  if (fromRevision.isPending || toRevision.isPending) {
    return (
      <output aria-label="Loading diff">
        <Skeleton className="h-96 w-full rounded-xl" />
      </output>
    );
  }
  const retry = () => {
    void fromRevision.refetch();
    void toRevision.refetch();
  };
  if (fromRevision.isError) return <DiffFailed error={fromRevision.error} onRetry={retry} />;
  if (toRevision.isError) return <DiffFailed error={toRevision.error} onRetry={retry} />;
  return (
    <div className="h-dvh min-w-0 overflow-auto rounded-xl border">
      <RevisionDiff
        from={fromRevision.data}
        to={toRevision.data}
        view={wide ? 'split' : 'unified'}
      />
    </div>
  );
}

function HistoryBody({
  featureId,
  from,
  to,
}: {
  featureId: string;
  from: number | undefined;
  to: number | undefined;
}) {
  const revisions = usePlanRevisions(featureId);
  const navigate = useNavigate();
  const retry = () => void revisions.refetch();

  if (revisions.isPending) {
    return (
      <output aria-label="Loading revisions">
        <Skeleton className="h-96 w-full rounded-xl" />
      </output>
    );
  }
  if (revisions.isError && revisions.data === undefined) {
    const message = isApiError(revisions.error, 'NOT_FOUND')
      ? 'The feature does not exist, or it belongs to someone else.'
      : revisions.error.message;
    return <LoadFailed title="Revisions could not be loaded" message={message} onRetry={retry} />;
  }
  const items = revisions.data.pages.flatMap((page) => page.items);
  const [newest, secondNewest] = items;
  const stale = revisions.isRefetchError && <StaleNotice onRetry={retry} />;
  if (newest === undefined) {
    return (
      <>
        {stale}
        <NothingToCompare title="No revisions yet" />
      </>
    );
  }
  if (secondNewest === undefined) {
    return (
      <>
        {stale}
        <NothingToCompare title="Only one revision so far." />
      </>
    );
  }
  const shownFrom = from ?? secondNewest.number;
  const shownTo = to ?? newest.number;
  const pick = (search: { from: number; to: number }) =>
    void navigate({ to: '/features/$featureId/plan/revisions', params: { featureId }, search });

  return (
    <>
      {stale}
      <div className="flex flex-col gap-3 md:grid md:grid-cols-2">
        <RevisionPicker
          id="revision-from"
          label="From"
          revisions={items}
          value={shownFrom}
          onPick={(number) => pick({ from: number, to: shownTo })}
        />
        <RevisionPicker
          id="revision-to"
          label="To"
          revisions={items}
          value={shownTo}
          onPick={(number) => pick({ from: shownFrom, to: number })}
        />
      </div>
      <LoadMore
        hasNextPage={revisions.hasNextPage}
        isFetchingNextPage={revisions.isFetchingNextPage}
        nextPageError={revisions.isFetchNextPageError ? revisions.error : null}
        onLoadMore={() => void revisions.fetchNextPage()}
      />
      <PickedDiff featureId={featureId} from={shownFrom} to={shownTo} />
    </>
  );
}

/**
 * Compares two revisions of a feature's plan. The picked numbers live in the URL, and with none
 * picked the screen compares the two newest.
 */
export function RevisionHistoryScreen({
  featureId,
  from,
  to,
}: {
  featureId: string;
  from: number | undefined;
  to: number | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <BackToPlan featureId={featureId} />
      <h1 className="text-xl font-semibold">Revision history</h1>
      <HistoryBody featureId={featureId} from={from} to={to} />
    </div>
  );
}
