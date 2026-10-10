import { createFileRoute, Outlet } from '@tanstack/react-router';
import { FeatureTabs } from '@/features/features/feature-tabs';

function FeaturesLayout() {
  return (
    <div className="flex flex-col gap-4">
      <FeatureTabs />
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute('/_app/features')({
  component: FeaturesLayout,
});
