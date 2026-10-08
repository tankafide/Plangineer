import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';

/** The signed-in user's runners, newest first, a page at a time. */
export function useRunnerList() {
  return useInfiniteQuery(
    useApiUtils().runner.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
}

/** Creates a one-time pairing code for `pnpm runner pair`. */
export function useCreatePairingCode() {
  return useMutation(useApiUtils().runner.createPairingCode.mutationOptions());
}

/** Revokes a runner. Revoking ends the runner's open runs, so the run list is refreshed too. */
export function useRevokeRunner() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.runner.revoke.mutationOptions({
      onSuccess: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: utils.runner.list.key() }),
          queryClient.invalidateQueries({ queryKey: utils.run.key() }),
        ]),
    }),
  );
}
