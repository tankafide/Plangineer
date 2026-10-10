import { useUpdateContextFile } from '@plangineer/api-client';
import type { ContextFileSummary } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { Item, ItemContent, ItemTitle } from '@/components/ui/item';

/** One context file: its tick, which planning reads, its title and Open. */
function ContextFileRow({ featureId, file }: { featureId: string; file: ContextFileSummary }) {
  const update = useUpdateContextFile();
  const titleId = `context-file-${file.id}-title`;
  // While a tick saves, the box shows the value being saved.
  const ticked = update.isPending ? (update.variables.ticked ?? file.ticked) : file.ticked;
  return (
    <Item variant="outline" className="flex-nowrap">
      <Checkbox
        className="after:-inset-3.5"
        checked={ticked}
        disabled={update.isPending}
        onCheckedChange={(checked) => update.mutate({ contextFileId: file.id, ticked: checked })}
        aria-labelledby={titleId}
      />
      <ItemContent className="min-w-0">
        <ItemTitle id={titleId} className="w-full min-w-0 break-words whitespace-normal">
          {file.title}
        </ItemTitle>
        {update.isError && (
          <p className="text-destructive">The tick could not be saved: {update.error.message}</p>
        )}
      </ItemContent>
      <Link
        to="/features/$featureId/files/$contextFileId"
        params={{ featureId, contextFileId: file.id }}
        aria-label={`Open ${file.title}`}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        Open
      </Link>
    </Item>
  );
}

/** The feature's context files. Ticked files are the ones planning reads. */
export function ContextFileList({
  featureId,
  files,
}: {
  featureId: string;
  files: readonly ContextFileSummary[];
}) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>Context files</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {files.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No context files yet</EmptyTitle>
              <EmptyDescription>Context files appear here as tasks finish.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul aria-label="Context files" className="flex flex-col gap-2">
            {files.map((file) => (
              <li key={file.id} className="min-w-0">
                <ContextFileRow featureId={featureId} file={file} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
