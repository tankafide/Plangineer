import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';
import { storeRepository } from './repositories.ts';

/** Scans a repository. Each setup mutation returns the repository, which replaces the cached one. */
export function useScanRepository() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repositorySetup.scan.mutationOptions({
      onSuccess: (repository) => storeRepository(utils, queryClient, repository),
    }),
  );
}

/** Starts a setup run with the admin's choices. */
export function useStartSetup() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repositorySetup.start.mutationOptions({
      onSuccess: (repository) => storeRepository(utils, queryClient, repository),
    }),
  );
}

/** Checks the setup's run or pull request now. */
export function useRefreshSetup() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.repositorySetup.refresh.mutationOptions({
      onSuccess: (repository) => storeRepository(utils, queryClient, repository),
    }),
  );
}
