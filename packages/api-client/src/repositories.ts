import type { RepositoryDetail } from '@plangineer/contracts';
import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type ApiUtils, useApiUtils } from './api-provider.tsx';

/** Writes a repository a mutation returned to its detail key and refetches the list. */
export async function storeRepository(
  utils: ApiUtils,
  queryClient: QueryClient,
  repository: RepositoryDetail,
): Promise<void> {
  queryClient.setQueryData(
    utils.repository.get.queryKey({ input: { repositoryId: repository.id } }),
    repository,
  );
  await queryClient.invalidateQueries({ queryKey: utils.repository.list.key() });
}

/** The configured repositories, newest first, a page at a time. */
export function useRepositoryList() {
  return useInfiniteQuery(
    useApiUtils().repository.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor }),
      initialPageParam: undefined,
      getNextPageParam: (page) => page.nextCursor ?? undefined,
    }),
  );
}

/**
 * The repositories the GitHub App reaches that are not added yet. It refetches when the window
 * regains focus, so a repository the admin just installed the App on appears without a reload.
 */
export function useInstallableRepositoryList() {
  return useQuery({
    ...useApiUtils().repository.listInstallable.queryOptions(),
    refetchOnWindowFocus: true,
  });
}

export function useRepository(repositoryId: string) {
  return useQuery(useApiUtils().repository.get.queryOptions({ input: { repositoryId } }));
}

/** Adds a repository. It disappears from the installable list, so that list refetches too. */
export function useAddRepository() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repository.add.mutationOptions({
      onSuccess: async (repository) => {
        await storeRepository(utils, queryClient, repository);
        await queryClient.invalidateQueries({ queryKey: utils.repository.listInstallable.key() });
      },
    }),
  );
}

export function useUpdateRepository() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repository.update.mutationOptions({
      onSuccess: (repository) => storeRepository(utils, queryClient, repository),
    }),
  );
}

/** Removes a repository, dropping its cached detail and refetching the lists. */
export function useRemoveRepository() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repository.remove.mutationOptions({
      onSuccess: async ({ repositoryId }) => {
        queryClient.removeQueries({
          queryKey: utils.repository.get.queryKey({ input: { repositoryId } }),
        });
        await queryClient.invalidateQueries({ queryKey: utils.repository.list.key() });
        await queryClient.invalidateQueries({ queryKey: utils.repository.listInstallable.key() });
      },
    }),
  );
}
