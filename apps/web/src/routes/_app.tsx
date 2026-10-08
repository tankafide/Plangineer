import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { AppHeader } from '@/features/app-shell/app-header';
import { readSession } from '@/lib/auth-client';

function AppLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader />
      <main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col px-4 py-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const session = await readSession();
    if (session === null) throw redirect({ to: '/sign-in' });
  },
  component: AppLayout,
});
