import { createFileRoute } from '@tanstack/react-router';
import { RunsScreen } from '@/features/runs/runs-screen';

export const Route = createFileRoute('/_app/runs/')({
  component: RunsScreen,
});
