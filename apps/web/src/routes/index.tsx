import { createFileRoute, redirect } from '@tanstack/react-router';
import { AccountSummary } from '@/features/account/account-summary';
import { authClient } from '@/lib/auth-client';

function HomePage() {
  return (
    <main className="flex min-h-svh items-start justify-center px-4 py-8 md:py-16">
      <AccountSummary />
    </main>
  );
}

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (data === null) throw redirect({ to: '/sign-in' });
  },
  component: HomePage,
});
