import { createFileRoute } from '@tanstack/react-router';
import { RepositoriesScreen } from '@/features/repositories/repositories-screen';

export const Route = createFileRoute('/_app/repositories/')({
  component: RepositoriesScreen,
});
