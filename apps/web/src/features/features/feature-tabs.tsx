import { useFeatureList } from '@plangineer/api-client';
import type { FeatureSummary } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';
import { FeatureStateBadge } from './feature-state-badge';

const TAB_CLASS =
  'inline-flex min-h-11 max-w-full min-w-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 ease-out outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none data-[status=active]:border-ring data-[status=active]:bg-muted data-[status=active]:text-foreground';

function FeatureTab({ feature }: { feature: FeatureSummary }) {
  return (
    <Link to="/features/$featureId" params={{ featureId: feature.id }} className={TAB_CLASS}>
      <span className="max-w-48 min-w-0 truncate">{feature.title}</span>
      <FeatureStateBadge state={feature.state} />
    </Link>
  );
}

function TabsState({ features }: { features: ReturnType<typeof useFeatureList> }) {
  if (features.isPending) {
    return (
      <output aria-label="Loading feature tabs" className="flex gap-2">
        <Skeleton className="h-11 w-40 rounded-lg" />
        <Skeleton className="h-11 w-40 rounded-lg" />
      </output>
    );
  }
  const failed = features.isError && features.data === undefined;
  if (failed || features.isRefetchError) {
    return (
      <p
        className={cn(
          'flex flex-wrap items-center gap-2',
          failed ? 'text-destructive' : 'text-warning',
        )}
      >
        {failed ? 'Your features could not be loaded.' : 'Your features could not be refreshed.'}
        <Button variant="outline" size="sm" onClick={() => void features.refetch()}>
          Retry
        </Button>
      </p>
    );
  }
  return null;
}

/**
 * One tab per feature from the first page of the list, and New feature. Desktop only: on a phone
 * the feature list does this job.
 */
export function FeatureTabs() {
  const features = useFeatureList();
  const items = features.data?.pages[0]?.items ?? [];
  return (
    <nav aria-label="Features" className="hidden flex-col gap-2 md:flex">
      <TabsState features={features} />
      <ul className="flex flex-wrap gap-2">
        {items.map((feature) => (
          <li key={feature.id} className="min-w-0">
            <FeatureTab feature={feature} />
          </li>
        ))}
        <li>
          <Link to="/features/new" className={TAB_CLASS}>
            <Plus aria-hidden className="size-4" />
            New feature
          </Link>
        </li>
      </ul>
    </nav>
  );
}
