import { RunnerUserCode } from '@plangineer/contracts';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { ApproveRunnerScreen } from '@/features/runners/approve-runner-screen';

const ApproveSearch = z.object({ code: RunnerUserCode.optional().catch(undefined) });

function ApprovePage() {
  const { code } = Route.useSearch();
  return <ApproveRunnerScreen userCode={code} />;
}

export const Route = createFileRoute('/_app/runners/approve')({
  validateSearch: ApproveSearch,
  component: ApprovePage,
});
