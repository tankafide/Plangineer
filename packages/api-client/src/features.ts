import { isDefinedError } from '@orpc/client';
import type { FeatureDetail, StartPlanningConflictData } from '@plangineer/contracts';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type ApiUtils, useApiUtils } from './api-provider.tsx';

/** How often a feature still in pre-planning is read again, so its tasks and files show up. */
const PRE_PLANNING_INTERVAL_MS = 3_000;

/** Writes a feature a mutation returned to its detail key and refetches the feature list. */
async function storeFeature(
  utils: ApiUtils,
  queryClient: QueryClient,
  feature: FeatureDetail,
): Promise<void> {
  queryClient.setQueryData(
    utils.feature.get.queryKey({ input: { featureId: feature.id } }),
    feature,
  );
  await queryClient.invalidateQueries({ queryKey: utils.feature.list.key() });
}

/**
 * The signed-in user's features, newest first, a page at a time. Read again every 3 s while a
 * loaded feature is in pre-planning, so the tabs follow its state.
 */
export function useFeatureList() {
  return useInfiniteQuery({
    ...useApiUtils().feature.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some((feature) => feature.state === 'pre_planning'),
      )
        ? PRE_PLANNING_INTERVAL_MS
        : false,
  });
}

/**
 * One feature, read again every 3 s while it is in pre-planning. A read that finds a new state
 * refetches the feature list, so the tabs follow.
 */
export function useFeature(featureId: string) {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  const queryKey = utils.feature.get.queryKey({ input: { featureId } });
  return useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData(queryKey);
      const feature = await utils.feature.get.call({ featureId }, { signal });
      if (previous !== undefined && previous.state !== feature.state) {
        await queryClient.invalidateQueries({ queryKey: utils.feature.list.key() });
      }
      return feature;
    },
    refetchInterval: (query) =>
      query.state.data?.state === 'pre_planning' ? PRE_PLANNING_INTERVAL_MS : false,
  });
}

/** Submits the intake form. The new feature is written to its detail key, so its tab opens at once. */
export function useCreateFeature() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.feature.create.mutationOptions({
      onSuccess: (feature) => storeFeature(utils, queryClient, feature),
    }),
  );
}

/** Changes a feature's run mode. The returned feature replaces the cached one. */
export function useUpdateFeature() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.feature.update.mutationOptions({
      onSuccess: (feature) => storeFeature(utils, queryClient, feature),
    }),
  );
}

/** Moves a feature to planning. The returned feature replaces the cached one. */
export function useStartPlanning() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.feature.startPlanning.mutationOptions({
      onSuccess: (feature) => storeFeature(utils, queryClient, feature),
    }),
  );
}

type StartPlanningError = ReturnType<typeof useStartPlanning>['error'];

/** Why the API refused to start planning, or null for any other error. */
export function startPlanningConflictReason(
  error: NonNullable<StartPlanningError>,
): StartPlanningConflictData['reason'] | null {
  return isDefinedError(error) && error.code === 'CONFLICT' ? error.data.reason : null;
}
