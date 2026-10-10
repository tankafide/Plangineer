import { FeatureDetail } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { FeatureScreen } from '@/features/features/feature-screen';

function FeaturePage() {
  const { featureId } = Route.useParams();
  return <FeatureScreen featureId={featureId} />;
}

export const Route = createFileRoute('/_app/features/$featureId/')({
  beforeLoad: ({ params }) => {
    if (!FeatureDetail.shape.id.safeParse(params.featureId).success) throw notFound();
  },
  component: FeaturePage,
});
