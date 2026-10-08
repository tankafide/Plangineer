import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';

/** The signed-in user's runs, newest first, a page at a time. */
export function useRunList() {
  return useInfiniteQuery(
    useApiUtils().run.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
}

/** One run. useRunEvents keeps it current while its stream is open. */
export function useRun(runId: string) {
  return useQuery(useApiUtils().run.get.queryOptions({ input: { runId } }));
}

/** Starts a test run. The new run is written to its detail key, so its page opens without a fetch. */
export function useCreateRun() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.run.create.mutationOptions({
      onSuccess: async (run) => {
        queryClient.setQueryData(utils.run.get.queryKey({ input: { runId: run.id } }), run);
        await queryClient.invalidateQueries({ queryKey: utils.run.list.key() });
      },
    }),
  );
}

/** Asks for a run to stop. The returned run replaces the cached one. */
export function useCancelRun() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.run.cancel.mutationOptions({
      onSuccess: async (run) => {
        queryClient.setQueryData(utils.run.get.queryKey({ input: { runId: run.id } }), run);
        await queryClient.invalidateQueries({ queryKey: utils.run.list.key() });
      },
    }),
  );
}
