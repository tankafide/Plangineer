import { FeatureDetail } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { PlanWorkspaceScreen } from '@/features/plan/plan-workspace-screen';

function PlanPage() {
  const { featureId } = Route.useParams();
  return <PlanWorkspaceScreen featureId={featureId} />;
}

export const Route = createFileRoute('/_app/features/$featureId/plan/')({
  beforeLoad: ({ params }) => {
    if (!FeatureDetail.shape.id.safeParse(params.featureId).success) throw notFound();
  },
  component: PlanPage,
});
