import { createFileRoute, Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { FeatureList } from '@/features/features/feature-list';

function FeaturesPage() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Features</h1>
        <Link to="/features/new" className={buttonVariants()}>
          New feature
        </Link>
      </div>
      <FeatureList />
    </div>
  );
}

export const Route = createFileRoute('/_app/features/')({
  component: FeaturesPage,
});
