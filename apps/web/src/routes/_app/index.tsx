import { createFileRoute } from '@tanstack/react-router';
import { AccountSummary } from '@/features/account/account-summary';
import { GetStartedCard } from '@/features/get-started/get-started-card';

function HomePage() {
  return (
    <div className="flex flex-col items-center gap-4">
      <GetStartedCard />
      <AccountSummary />
    </div>
  );
}

export const Route = createFileRoute('/_app/')({
  component: HomePage,
});
