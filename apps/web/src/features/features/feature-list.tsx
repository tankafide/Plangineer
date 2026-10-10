import { useFeatureList } from '@plangineer/api-client';
import type { FeatureSummary } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { LoadFailed } from '@/components/load-failed';
import { LoadMore } from '@/components/load-more';
import { StaleNotice } from '@/components/stale-notice';
import { buttonVariants } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/date-time';
import { FeatureStateBadge } from './feature-state-badge';

function LoadingFeatures() {
  return (
    <output aria-label="Loading features" className="flex flex-col gap-2">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-16 w-full rounded-lg" />
    </output>
  );
}

function FeatureRow({ feature }: { feature: FeatureSummary }) {
  return (
    <Item
      variant="outline"
      className="bg-card"
      render={<Link to="/features/$featureId" params={{ featureId: feature.id }} />}
    >
      <ItemContent className="min-w-0">
        <ItemTitle className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-words">{feature.title}</span>
          <FeatureStateBadge state={feature.state} />
        </ItemTitle>
        <ItemDescription>{formatDateTime(feature.createdAt)}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function NoFeatures() {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>No features yet</EmptyTitle>
        <EmptyDescription>
          Start a feature to explore and research it before planning.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Link to="/features/new" className={buttonVariants()}>
          New feature
        </Link>
      </EmptyContent>
    </Empty>
  );
}

/** The signed-in user's features, newest first. On a phone, the rows are the feature tabs. */
export function FeatureList() {
  const features = useFeatureList();
  const retry = () => void features.refetch();

  if (features.isPending) return <LoadingFeatures />;
  if (features.isError && features.data === undefined) {
    return (
      <LoadFailed
        title="Features could not be loaded"
        message={features.error.message}
        onRetry={retry}
      />
    );
  }

  const items = features.data.pages.flatMap((page) => page.items);
  return (
    <div className="flex flex-col gap-4">
      {features.isRefetchError && <StaleNotice onRetry={retry} />}
      {items.length === 0 ? (
        <NoFeatures />
      ) : (
        <ul aria-label="Your features" className="flex flex-col gap-2">
          {items.map((feature) => (
            <li key={feature.id} className="min-w-0">
              <FeatureRow feature={feature} />
            </li>
          ))}
        </ul>
      )}
      <LoadMore
        hasNextPage={features.hasNextPage}
        isFetchingNextPage={features.isFetchingNextPage}
        nextPageError={features.isFetchNextPageError ? features.error : null}
        onLoadMore={() => void features.fetchNextPage()}
      />
    </div>
  );
}
