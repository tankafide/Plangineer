import { zodResolver } from '@hookform/resolvers/zod';
import { useStartSetup } from '@plangineer/api-client';
import {
  InvalidSelectionData,
  type RepositoryScan,
  type SelectionError,
  type SetupSelection,
} from '@plangineer/contracts';
import { CircleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { RunnerField } from '@/features/runs/runner-field';
import { PathList } from './path-list';
import { SetupChecklists } from './setup-checklists';
import {
  initialTicks,
  selectionFromTicks,
  SetupFields,
  type SetupFieldsInput,
  type SetupFieldsOutput,
} from './setup-fields';
import { UnmovableContent } from './unmovable-content';

const SELECTION_ERRORS: Record<SelectionError, string> = {
  unmovable_content: 'Move or delete these files, then scan again.',
  nothing_chosen: 'Tick at least one skill to add or one orchestrator.',
  unknown_skill: 'These skills are not in the scan or the catalog. Scan again.',
  skill_exists: 'These skills are already in the repository. Scan again.',
  orchestrator_exists: 'These orchestrators are already in the repository. Scan again.',
  required_skill_missing: 'Every setup needs these required skills.',
  too_large: 'The setup is too large to send to a runner.',
};

/** The INVALID_SELECTION data of a failed start, or null for any other error. */
function invalidSelection(error: Error): InvalidSelectionData | null {
  if (!('defined' in error) || error.defined !== true) return null;
  if (!('code' in error) || error.code !== 'INVALID_SELECTION' || !('data' in error)) return null;
  const data = InvalidSelectionData.safeParse(error.data);
  return data.success ? data.data : null;
}

function StartFailure({ error }: { error: Error }) {
  const selection = invalidSelection(error);
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>The pull request could not be generated</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        {selection === null ? (
          <p>{error.message}</p>
        ) : (
          <>
            <p>{SELECTION_ERRORS[selection.reason]}</p>
            {selection.names.length > 0 && <PathList paths={selection.names} label="Names" />}
          </>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** The admin's setup choices: the checklists, a runner and Generate pull request. */
export function SetupForm({
  repositoryId,
  scan,
  selection,
}: {
  repositoryId: string;
  scan: RepositoryScan;
  selection: SetupSelection | null;
}) {
  const start = useStartSetup();
  const form = useForm<SetupFieldsInput, unknown, SetupFieldsOutput>({
    resolver: zodResolver(SetupFields),
    defaultValues: { runnerId: '', ...initialTicks(scan, selection) },
  });
  const blocked = scan.unmovableContent.length > 0;
  const submit = form.handleSubmit(({ runnerId, ...ticks }) =>
    start.mutate({ repositoryId, runnerId, selection: selectionFromTicks(scan, ticks) }),
  );

  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
      {blocked ? (
        <UnmovableContent paths={scan.unmovableContent} />
      ) : (
        <SetupChecklists scan={scan} control={form.control} />
      )}
      <RunnerField control={form.control} name="runnerId" idPrefix="setup" />
      <Button
        type="submit"
        className="w-full md:w-auto md:self-start"
        disabled={blocked || start.isPending}
      >
        {start.isPending ? 'Starting…' : 'Generate pull request'}
      </Button>
      {start.isError && <StartFailure error={start.error} />}
    </form>
  );
}
