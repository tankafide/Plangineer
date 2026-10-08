import { createFileRoute } from '@tanstack/react-router';
import { RunnersScreen } from '@/features/runners/runners-screen';

export const Route = createFileRoute('/_app/runners')({
  component: RunnersScreen,
});
