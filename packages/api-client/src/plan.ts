import { ORPCError } from '@orpc/client';
import {
  isRunActive,
  type PlanBody,
  PlanConflictData,
  type PlanConflictReason,
  type PlanWorkspace,
} from '@plangineer/contracts';
import {
  type QueryClient,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useEffect } from 'react';
import { type ApiUtils, useApiUtils } from './api-provider.tsx';
import { useRunEvents } from './run-events.ts';

/** Refetches what a turn or a plan write may have changed: the feature and the feature list. */
async function invalidateFeature(utils: ApiUtils, queryClient: QueryClient, featureId: string) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: utils.feature.get.queryKey({ input: { featureId } }),
    }),
    queryClient.invalidateQueries({ queryKey: utils.feature.list.key() }),
  ]);
}

/** Writes a workspace a plan write returned to its plan.get key and refetches its feature. */
async function storeWorkspace(
  utils: ApiUtils,
  queryClient: QueryClient,
  workspace: PlanWorkspace,
): Promise<void> {
  queryClient.setQueryData(
    utils.plan.get.queryKey({ input: { featureId: workspace.featureId } }),
    workspace,
  );
  await invalidateFeature(utils, queryClient, workspace.featureId);
}

/** A feature's plan workspace: its latest revision, turn, questions, readiness and sections. */
export function usePlan(featureId: string) {
  return useQuery(useApiUtils().plan.get.queryOptions({ input: { featureId } }));
}

/**
 * Follows the latest turn's run events while the turn runs, and opens no stream otherwise. When
 * the stream ends, the workspace and its feature refetch, so the turn's result shows.
 */
export function usePlanTurnEvents(workspace: PlanWorkspace | undefined) {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  const turn = workspace?.turn ?? null;
  const runId = turn !== null && isRunActive(turn.status) ? turn.runId : skipToken;
  const stream = useRunEvents(runId);
  const featureId = workspace?.featureId;
  const ended = stream.state.status === 'ended';

  useEffect(() => {
    if (!ended || featureId === undefined) return;
    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: utils.plan.get.queryKey({ input: { featureId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: utils.feature.get.queryKey({ input: { featureId } }),
      }),
    ]);
  }, [ended, featureId, utils, queryClient]);

  return stream;
}

/** Answers an open question with a choice or text. */
export function useAnswerQuestion() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.answer.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/** Queues the next guided turn. */
export function useContinuePlanning() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.continue.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/** Queues the failed or cancelled latest turn again. */
export function useRetryTurn() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.retry.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/** Asks the agent to expand, simplify or regenerate one section. */
export function useSectionAction() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.sectionAction.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/** Asks the agent to revise one step as the engineer's instruction says. */
export function useReviseStep() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.reviseStep.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/** Marks a ready plan ready for review. */
export function useMarkReady() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.plan.markReady.mutationOptions({
      onSuccess: (workspace) => storeWorkspace(utils, queryClient, workspace),
    }),
  );
}

/**
 * Saves an engineer's edit of the plan body. Edits of one feature run one at a time in their
 * scope, and each reads the latest revision number from the cache when it runs, so a second
 * quick edit sends the number the first returned. The body shows at once, a failure puts the
 * previous workspace back, and only the last pending edit refetches when it settles.
 */
export function useEditPlan(featureId: string) {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  const planKey = utils.plan.get.queryKey({ input: { featureId } });
  const mutationKey = utils.plan.edit.mutationKey();
  const otherEditsPending = () => queryClient.isMutating({ mutationKey }) > 1;

  return useMutation({
    mutationKey,
    scope: { id: `plan-edit-${featureId}` },
    mutationFn: ({ body }: { body: PlanBody }) => {
      const revision = queryClient.getQueryData(planKey)?.revision;
      if (revision === undefined || revision === null) {
        throw new Error(`Feature ${featureId} has no plan revision to edit`);
      }
      return utils.plan.edit.call({ featureId, revision: revision.number, body });
    },
    onMutate: async ({ body }) => {
      await queryClient.cancelQueries({ queryKey: planKey });
      const previous = queryClient.getQueryData(planKey);
      queryClient.setQueryData(planKey, (workspace) =>
        workspace?.revision
          ? { ...workspace, revision: { ...workspace.revision, body } }
          : workspace,
      );
      return { previous };
    },
    onSuccess: async (workspace) => {
      // A later edit still pending keeps its body on screen and takes the new revision number.
      const pendingBody = otherEditsPending()
        ? queryClient.getQueryData(planKey)?.revision?.body
        : undefined;
      queryClient.setQueryData(
        planKey,
        pendingBody === undefined || workspace.revision === null
          ? workspace
          : { ...workspace, revision: { ...workspace.revision, body: pendingBody } },
      );
      await invalidateFeature(utils, queryClient, featureId);
    },
    onError: (_error, _variables, context) => {
      if (context !== undefined) queryClient.setQueryData(planKey, context.previous);
    },
    onSettled: async () => {
      if (!otherEditsPending()) await queryClient.invalidateQueries({ queryKey: planKey });
    },
  });
}

/** A feature's plan revisions, newest first, a page at a time. */
export function usePlanRevisions(featureId: string) {
  return useInfiniteQuery(
    useApiUtils().plan.revisions.infiniteOptions({
      input: (cursor: string | undefined) => ({ featureId, cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
}

/** One plan revision by number. Revisions never change, so a loaded one is never read again. */
export function usePlanRevision(featureId: string, number: number | undefined) {
  return useQuery({
    ...useApiUtils().plan.revision.queryOptions({
      input: number === undefined ? skipToken : { featureId, number },
    }),
    staleTime: Infinity,
  });
}

/** Why the API refused a plan write, or null for any other error. */
export function planConflictReason(error: unknown): PlanConflictReason | null {
  if (!(error instanceof ORPCError && error.defined && error.code === 'CONFLICT')) return null;
  return PlanConflictData.parse(error.data).reason;
}
