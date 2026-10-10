import { FeatureDetail } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { z } from 'zod';
import { RevisionHistoryScreen } from '@/features/plan/revision-history-screen';

/** The two revisions compared. A missing or broken number falls back to the screen's default. */
const RevisionsSearch = z.object({
  from: z.int().min(1).optional().catch(undefined),
  to: z.int().min(1).optional().catch(undefined),
});

function RevisionsPage() {
  const { featureId } = Route.useParams();
  const { from, to } = Route.useSearch();
  return <RevisionHistoryScreen featureId={featureId} from={from} to={to} />;
}

export const Route = createFileRoute('/_app/features/$featureId/plan/revisions')({
  validateSearch: RevisionsSearch,
  beforeLoad: ({ params }) => {
    if (!FeatureDetail.shape.id.safeParse(params.featureId).success) throw notFound();
  },
  component: RevisionsPage,
});
