import { ApiProvider } from '@plangineer/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type AnyRouter,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { routeTree } from '@/routeTree.gen';

export { server } from './msw-server.ts';

export const RPC_URL = `${window.location.origin}/rpc`;
export const AUTH_URL = `${window.location.origin}/api/auth`;

export function rpcBody(json: unknown) {
  return { json, meta: [] };
}

async function renderRouter(router: AnyRouter) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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

/** Renders a page component at / inside the app's providers, with a stub /sign-in route. */
export function renderPage(Page: () => ReactNode) {
  const rootRoute = createRootRoute({ component: Outlet });
  return renderRouter(
    createRouter({
      routeTree: rootRoute.addChildren([
        createRoute({ getParentRoute: () => rootRoute, path: '/', component: Page }),
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/sign-in',
          component: () => <p>Sign-in page</p>,
        }),
      ]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    }),
  );
}

/** Renders the app's real route tree at the given path. */
export function renderRoute(path: string) {
  return renderRouter(
    createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) }),
  );
}
