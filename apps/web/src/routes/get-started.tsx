import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { GetStartedScreen } from '@/features/get-started/get-started-screen';
import { captureSetupToken } from '@/features/get-started/setup-token';

/** What GitHub's redirect carries after the App is created. Both leave the URL once read. */
const GetStartedSearch = z.object({
  code: z.string().optional().catch(undefined),
  state: z.string().optional().catch(undefined),
});

function GetStartedPage() {
  const { code, state } = Route.useSearch();
  return (
    <main className="flex min-h-svh flex-col">
      <GetStartedScreen code={code} state={state} />
    </main>
  );
}

export const Route = createFileRoute('/get-started')({
  validateSearch: GetStartedSearch,
  beforeLoad: () => captureSetupToken(),
  component: GetStartedPage,
});
