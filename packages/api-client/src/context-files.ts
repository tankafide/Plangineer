import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';

/** One context file with its content. */
export function useContextFile(contextFileId: string) {
  return useQuery(useApiUtils().contextFile.get.queryOptions({ input: { contextFileId } }));
}

/**
 * Renames, edits or ticks a context file. The returned file replaces the cached one, and its
 * feature refetches, so the feature screen shows the new title and tick.
 */
export function useUpdateContextFile() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.contextFile.update.mutationOptions({
      onSuccess: async (file) => {
        queryClient.setQueryData(
          utils.contextFile.get.queryKey({ input: { contextFileId: file.id } }),
          file,
        );
        await queryClient.invalidateQueries({
          queryKey: utils.feature.get.queryKey({ input: { featureId: file.featureId } }),
        });
      },
    }),
  );
}

/**
 * Deletes a context file and drops its cached copy. The answer names only the file, so every
 * cached feature refetches.
 */
export function useDeleteContextFile() {
  const utils = useApiUtils();
  const queryClient = useQueryClient();
  return useMutation(
    utils.contextFile.delete.mutationOptions({
      onSuccess: async ({ id }) => {
        await queryClient.invalidateQueries({ queryKey: utils.feature.get.key() });
        queryClient.removeQueries({
          queryKey: utils.contextFile.get.queryKey({ input: { contextFileId: id } }),
        });
      },
    }),
  );
}
