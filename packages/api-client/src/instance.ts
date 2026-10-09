import { isDefinedError } from '@orpc/client';
import { skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';

/** How often the get-started screen reads the runners again, so Claude Code shows once it is ready. */
const SETUP_RUNNERS_INTERVAL_MS = 5_000;

/** Whether this install has its GitHub App yet. Public, so it works before anyone signs in. */
export function useInstanceStatus() {
  return useQuery(useApiUtils().instance.getStatus.queryOptions());
}

/** The manifest and the GitHub URL to post it to, for the setup token's holder. */
export function useGithubAppManifest() {
  return useMutation(useApiUtils().instance.githubAppManifest.mutationOptions());
}

/** Creates the GitHub App from GitHub's code. The returned status replaces the cached one. */
export function useCompleteGithubApp() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.instance.completeGithubApp.mutationOptions({
      onSuccess: (status) => queryClient.setQueryData(utils.instance.getStatus.queryKey(), status),
    }),
  );
}

type GithubAppSetupError = ReturnType<typeof useCompleteGithubApp>['error'];

/** GitHub's own message when GitHub refused the App, or the error's message otherwise. */
export function githubAppSetupFailure(error: NonNullable<GithubAppSetupError>): string {
  if (isDefinedError(error) && error.code === 'GITHUB_FAILED') return error.data.message;
  return error.message;
}

/**
 * The first 100 runners, read again every 5 s, for the get-started checklist. Nothing is sent
 * while disabled.
 */
export function useSetupRunners(enabled: boolean) {
  return useQuery({
    ...useApiUtils().runner.list.queryOptions({ input: enabled ? { limit: 100 } : skipToken }),
    refetchInterval: SETUP_RUNNERS_INTERVAL_MS,
  });
}

/** At most one repository, which is enough to know whether any is added. */
export function useSetupRepositories(enabled: boolean) {
  return useQuery(
    useApiUtils().repository.list.queryOptions({ input: enabled ? { limit: 1 } : skipToken }),
  );
}
