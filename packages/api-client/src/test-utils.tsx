import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { ApiProvider } from './api-provider.tsx';

export const RPC_URL = 'http://localhost/rpc';

/** The MSW server every test file shares; src/test-setup.ts starts and resets it. */
export const server = setupServer();

/** Wraps a hook under test in ApiProvider and the given QueryClient. */
export function apiWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiProvider url={RPC_URL}>{children}</ApiProvider>
      </QueryClientProvider>
    );
  };
}

export function rpcBody(json: unknown) {
  return { json, meta: [] };
}
