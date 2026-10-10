import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';
import { ApiProvider, useApiUtils } from './api-provider.tsx';

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

export function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

/** The input an RPC request carries. */
export async function rpcInput(request: Request): Promise<unknown> {
  const body: unknown = await request.json();
  return typeof body === 'object' && body !== null && 'json' in body ? body.json : null;
}

/** Answers a procedure with each body in turn, repeating the last, and records each input. */
export function answerProcedure(path: string, ...bodies: unknown[]) {
  const inputs: unknown[] = [];
  server.use(
    http.post(`${RPC_URL}/${path}`, async ({ request }) => {
      inputs.push(await rpcInput(request));
      return HttpResponse.json(rpcBody(bodies[Math.min(inputs.length - 1, bodies.length - 1)]));
    }),
  );
  return inputs;
}

/** Renders hooks beside the oRPC utils, so a test can build the keys they use. */
export function renderHooks<T>(useHooks: () => T, queryClient = newQueryClient()) {
  const view = renderHook(() => ({ hooks: useHooks(), utils: useApiUtils() }), {
    wrapper: apiWrapper(queryClient),
  });
  return { ...view, queryClient };
}

/** A CONFLICT answer with the given reason, as the plan procedures send it. */
export function rpcConflict(reason: string) {
  return HttpResponse.json(
    rpcBody({
      defined: true,
      code: 'CONFLICT',
      status: 409,
      message: 'Conflict',
      data: { reason },
    }),
    { status: 409 },
  );
}
