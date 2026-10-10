import { useDeleteContextFile } from '@plangineer/api-client';
import { useNavigate } from '@tanstack/react-router';
import { CircleAlert } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Delete, confirmed on a card in place. A delete returns to the feature. */
export function DeleteContextFile({
  featureId,
  contextFileId,
}: {
  featureId: string;
  contextFileId: string;
}) {
  const remove = useDeleteContextFile();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <Button variant="destructive" onClick={() => setConfirming(true)}>
        Delete
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border p-3">
      <p>Delete this context file? Planning will not read it, and it cannot be brought back.</p>
      {remove.isError && (
        <Alert variant="destructive">
          <CircleAlert aria-hidden />
          <AlertDescription>The file could not be deleted: {remove.error.message}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              { contextFileId },
              {
                onSuccess: () =>
                  void navigate({ to: '/features/$featureId', params: { featureId } }),
              },
            )
          }
        >
          {remove.isPending ? 'Deleting…' : 'Delete file'}
        </Button>
        <Button variant="outline" disabled={remove.isPending} onClick={() => setConfirming(false)}>
          Keep
        </Button>
      </div>
    </div>
  );
}
