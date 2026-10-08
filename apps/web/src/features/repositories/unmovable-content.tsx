import { CircleAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { PathList } from './path-list';

/** The files under .claude/skills that setup cannot move, which block it until they are gone. */
export function UnmovableContent({ paths }: { paths: readonly string[] }) {
  return (
    <Alert variant="warning">
      <CircleAlert aria-hidden />
      <AlertTitle>Move or delete these files, then scan again</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <p>Setup moves skills out of .claude/skills and cannot carry these files.</p>
        <PathList paths={paths} label="Files setup cannot move" />
      </AlertDescription>
    </Alert>
  );
}
