import { createFileRoute } from '@tanstack/react-router';
import { AccountSummary } from '@/features/account/account-summary';

function HomePage() {
  return (
    <div className="flex justify-center">
      <AccountSummary />
    </div>
  );
}

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
