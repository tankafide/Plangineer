import { ContextFile } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { ContextFileScreen } from '@/features/features/context-file-screen';

function ContextFilePage() {
  const { featureId, contextFileId } = Route.useParams();
  return <ContextFileScreen featureId={featureId} contextFileId={contextFileId} />;
}

export const Route = createFileRoute('/_app/features/$featureId/files/$contextFileId')({
  beforeLoad: ({ params }) => {
    const ids = [params.featureId, params.contextFileId];
    if (!ids.every((id) => ContextFile.shape.id.safeParse(id).success)) throw notFound();
  },
  component: ContextFilePage,
});
