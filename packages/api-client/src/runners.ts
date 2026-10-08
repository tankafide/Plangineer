import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
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

/** The login request a runner started, by its user code. Nothing is sent while the code is undefined. */
export function useRunnerLogin(userCode: string | undefined) {
  const utils = useApiUtils();
  return useQuery(
    utils.runner.getLogin.queryOptions({
      input: userCode === undefined ? skipToken : { userCode },
    }),
  );
}

/**
 * Approves a runner's login request. The returned request replaces the cached one. The runner
 * list is not refetched: the runner exists only once the terminal's next poll completes the login.
 */
export function useApproveRunnerLogin() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.runner.approveLogin.mutationOptions({
      onSuccess: (login, { userCode }) =>
        queryClient.setQueryData(utils.runner.getLogin.queryKey({ input: { userCode } }), login),
    }),
  );
}

/** Denies a runner's login request. The returned request replaces the cached one. */
export function useDenyRunnerLogin() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.runner.denyLogin.mutationOptions({
      onSuccess: (login, { userCode }) =>
        queryClient.setQueryData(utils.runner.getLogin.queryKey({ input: { userCode } }), login),
    }),
  );
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
