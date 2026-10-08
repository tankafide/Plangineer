import { RepositoryDetail } from '@plangineer/contracts';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { RepositoryScreen } from '@/features/repositories/repository-screen';

function RepositoryPage() {
  const { repositoryId } = Route.useParams();
  return <RepositoryScreen repositoryId={repositoryId} />;
}

export const Route = createFileRoute('/_app/repositories/$repositoryId')({
  beforeLoad: ({ params }) => {
    if (!RepositoryDetail.shape.id.safeParse(params.repositoryId).success) throw notFound();
  },
  component: RepositoryPage,
});
