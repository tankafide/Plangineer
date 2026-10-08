import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInCard } from '@/features/auth/sign-in-card';
import { readSession } from '@/lib/auth-client';

const SignInSearch = z.object({ error: z.string().optional().catch(undefined) });

function SignInPage() {
  const { error } = Route.useSearch();
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <SignInCard failed={error !== undefined} />
    </main>
  );
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: SignInSearch,
  beforeLoad: async () => {
    const session = await readSession();
    if (session !== null) throw redirect({ to: '/' });
  },
  component: SignInPage,
});
