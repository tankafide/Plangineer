import { ApiProvider } from '@plangineer/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { setupServer } from 'msw/node';
import type { ReactNode } from 'react';

/** The MSW server every test file shares; src/test/setup.ts starts and resets it. */
export const server = setupServer();

export const RPC_URL = `${window.location.origin}/rpc`;
export const AUTH_URL = `${window.location.origin}/api/auth`;

export function rpcBody(json: unknown) {
  return { json, meta: [] };
}

/** Renders a page component at / inside the app's providers, with a stub /sign-in route. */
export async function renderPage(Page: () => ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({ getParentRoute: () => rootRoute, path: '/', component: Page }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/sign-in',
        component: () => <p>Sign-in page</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider url={RPC_URL}>
        <RouterProvider router={router} />
      </ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, router };
}
