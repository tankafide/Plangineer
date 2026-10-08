import { Run } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { RunScreen } from '@/features/runs/run-screen';

function RunPage() {
  const { runId } = Route.useParams();
  return <RunScreen runId={runId} />;
}

export const Route = createFileRoute('/_app/runs/$runId')({
  beforeLoad: ({ params }) => {
    if (!Run.shape.id.safeParse(params.runId).success) throw notFound();
  },
  component: RunPage,
});
