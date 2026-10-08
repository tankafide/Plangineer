import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInCard } from '@/features/auth/sign-in-card';
import { readSession } from '@/lib/auth-client';
import { safeReturnPath } from '@/lib/safe-return-path';

const SignInSearch = z.object({
  error: z.string().optional().catch(undefined),
  /** Where to go after sign-in. Always a same-origin path, so the page is no open redirect. */
  redirect: z
    .string()
    .default('/')
    .transform((value) => safeReturnPath(value, window.location.origin))
    .catch('/'),
});

function SignInPage() {
  const { error, redirect: returnTo } = Route.useSearch();
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <SignInCard failed={error !== undefined} redirect={returnTo} />
    </main>
  );
}

export const Route = createFileRoute('/sign-in')({
  validateSearch: SignInSearch,
  beforeLoad: async ({ search }) => {
    const session = await readSession();
    if (session !== null) throw redirect({ href: search.redirect });
  },
  component: SignInPage,
});
