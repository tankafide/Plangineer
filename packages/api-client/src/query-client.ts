import { isDefinedError, ORPCError } from '@orpc/client';
import { QueryClient } from '@tanstack/react-query';

const MAX_QUERY_RETRIES = 2;

/** Only a network failure or a 5xx the contract does not define is worth another attempt. */
function isTransient(error: unknown): boolean {
  if (error instanceof ORPCError) return error.status >= 500 && !isDefinedError(error);
  // fetch rejects with a TypeError when the request never reaches the server.
  return error instanceof TypeError;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failureCount, error) => failureCount < MAX_QUERY_RETRIES && isTransient(error),
      },
      mutations: { retry: false },
    },
  });
}
