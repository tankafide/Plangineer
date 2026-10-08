import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** The next-page control of a paged list, with the error when the last page failed to load. */
export function LoadMore({
  hasNextPage,
  isFetchingNextPage,
  nextPageError,
  onLoadMore,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageError: Error | null;
  onLoadMore: () => void;
}) {
  if (!hasNextPage) return null;
  return (
    <div className="flex flex-col gap-3">
      {nextPageError !== null && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>More could not be loaded: {nextPageError.message}</AlertDescription>
        </Alert>
      )}
      <Button
        variant="outline"
        className="w-full md:w-auto md:self-center"
        disabled={isFetchingNextPage}
        onClick={onLoadMore}
      >
        {isFetchingNextPage ? 'Loading…' : 'Load more'}
      </Button>
    </div>
  );
}
