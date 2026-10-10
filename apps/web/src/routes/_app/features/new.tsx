import { createFileRoute } from '@tanstack/react-router';
import { IntakeScreen } from '@/features/features/intake-screen';

export const Route = createFileRoute('/_app/features/new')({
  component: IntakeScreen,
});
