import { createRootRoute, type ErrorComponentProps, Link, Outlet } from '@tanstack/react-router';

function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-medium">Page not found</h1>
      <Link to="/" className="text-link underline-offset-4 hover:underline">
        Go to your account
      </Link>
    </main>
  );
}

function RouteError({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-2 px-4 text-center">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        {error instanceof Error ? error.message : String(error)}
      </p>
    </main>
  );
}

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});
