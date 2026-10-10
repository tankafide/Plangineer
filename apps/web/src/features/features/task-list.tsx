import type { PrePlanningTask, PrePlanningTaskKind } from '@plangineer/contracts';
import { Link } from '@tanstack/react-router';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Item, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item';
import { RunStatusBadge } from '@/features/runs/run-status-badge';

const KIND_LABELS: Record<PrePlanningTaskKind, string> = {
  intake: 'Intake',
  exploration: 'Exploration',
  research: 'Research',
};

const SHORT_COMMIT_LENGTH = 12;

function TaskRow({ task }: { task: PrePlanningTask }) {
  const subject = task.topic ?? `${task.repository.owner}/${task.repository.name}`;
  return (
    <Item variant="outline">
      <ItemContent className="min-w-0">
        <ItemTitle className="flex min-w-0 flex-wrap items-center gap-2">
          {KIND_LABELS[task.kind]}
          <RunStatusBadge status={task.status} />
        </ItemTitle>
        <ItemDescription
          className={task.topic === null ? 'font-mono text-xs break-all' : 'break-words'}
        >
          {subject}
        </ItemDescription>
        {task.commit !== null && (
          <span className="font-mono text-xs text-muted-foreground">
            {task.commit.slice(0, SHORT_COMMIT_LENGTH)}
          </span>
        )}
      </ItemContent>
      <Link
        to="/runs/$runId"
        params={{ runId: task.runId }}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        View run
      </Link>
    </Item>
  );
}

/** The feature's pre-planning tasks, each with its run's status and commit. */
export function TaskList({ tasks }: { tasks: readonly PrePlanningTask[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>
          <h2>Tasks</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul aria-label="Tasks" className="flex flex-col gap-2">
          {tasks.map((task) => (
            <li key={task.id} className="min-w-0">
              <TaskRow task={task} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
