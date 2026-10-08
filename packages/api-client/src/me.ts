import { useQuery } from '@tanstack/react-query';
import { useApiUtils } from './api-provider.tsx';

/** The signed-in user. */
export function useMe() {
  return useQuery(useApiUtils().me.get.queryOptions());
}
