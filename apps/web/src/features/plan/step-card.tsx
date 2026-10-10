import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { CoverageColumn, PlanBody, PlanStep } from '@plangineer/contracts';
import { GripVertical } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { COVERAGE_COLUMN_LABELS } from './plan-labels';
import { ReviseStepForm } from './revise-step-form';
import { StepForm } from './step-form';

/** What the plan knows about each done-when line: its label and the columns that cover it. */
export interface LineCoverage {
  label: string;
  ticks: readonly CoverageColumn[];
}

type Mode = 'view' | 'edit' | 'revise';

function DoneWhenLines({
  step,
  coverage,
}: {
  step: PlanStep;
  coverage: ReadonlyMap<string, LineCoverage>;
}) {
  if (step.doneWhen.length === 0) {
    return <p className="text-muted-foreground">No done-when lines yet.</p>;
  }
  return (
    <ul aria-label="Done when" className="flex flex-col gap-2">
      {step.doneWhen.map((line) => {
        const lineCoverage = coverage.get(line.id);
        if (lineCoverage === undefined) {
          throw new Error(`Done-when line ${line.id} has no coverage row`);
        }
        return (
          <li key={line.id} className="flex min-w-0 flex-col gap-1">
            <span className="break-words">{`${lineCoverage.label}. ${line.text}`}</span>
            {lineCoverage.ticks.length === 0 ? (
              <Badge variant="warning">Uncovered</Badge>
            ) : (
              <span className="text-muted-foreground">
                Covered by{' '}
                {lineCoverage.ticks.map((tick) => COVERAGE_COLUMN_LABELS[tick]).join(', ')}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One plan step with its files, body and done-when lines. It moves by drag or by Move up and
 * Move down, opens its editor in place, and asks the agent to revise it.
 */
export function StepCard({
  featureId,
  revision,
  body,
  step,
  number,
  coverage,
  blockedReason,
  onMove,
}: {
  featureId: string;
  revision: number;
  body: PlanBody;
  step: PlanStep;
  number: number;
  coverage: ReadonlyMap<string, LineCoverage>;
  blockedReason: string | null;
  onMove: (offset: -1 | 1) => void;
}) {
  const [mode, setMode] = useState<Mode>('view');
  const blocked = blockedReason !== null;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: step.id, disabled: blocked || mode !== 'view' });
  const close = () => setMode('view');
  const headingId = `step-${step.id}-heading`;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      aria-labelledby={headingId}
      className="min-w-0"
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex min-w-0 items-center gap-2">
            <Button
              ref={setActivatorNodeRef}
              variant="ghost"
              size="icon"
              aria-label={`Drag step ${number}`}
              disabled={blocked || mode !== 'view'}
              {...attributes}
              {...listeners}
            >
              <GripVertical aria-hidden />
            </Button>
            <h3 id={headingId} className="min-w-0 font-semibold break-words">
              {`${number}. ${step.title}`}
            </h3>
          </CardTitle>
        </CardHeader>
        {mode === 'edit' ? (
          <CardContent>
            <StepForm featureId={featureId} body={body} step={step} onClose={close} />
          </CardContent>
        ) : (
          <CardContent className="flex min-w-0 flex-col gap-3">
            {step.files.length > 0 && (
              <ul aria-label="Files" className="flex flex-col gap-1 font-mono text-xs break-all">
                {step.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
            )}
            {step.body !== '' && <p className="break-words whitespace-pre-wrap">{step.body}</p>}
            <DoneWhenLines step={step} coverage={coverage} />
            {mode === 'revise' && (
              <ReviseStepForm
                featureId={featureId}
                revision={revision}
                stepId={step.id}
                onClose={close}
              />
            )}
          </CardContent>
        )}
        {mode === 'view' && (
          <CardFooter className="flex flex-col items-stretch gap-2">
            <div className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
              <Button
                variant="outline"
                disabled={blocked || number === 1}
                onClick={() => onMove(-1)}
              >
                Move up
              </Button>
              <Button
                variant="outline"
                disabled={blocked || number === body.steps.length}
                onClick={() => onMove(1)}
              >
                Move down
              </Button>
              <Button variant="outline" disabled={blocked} onClick={() => setMode('edit')}>
                Edit
              </Button>
              <Button variant="outline" disabled={blocked} onClick={() => setMode('revise')}>
                Ask the agent
              </Button>
            </div>
            {blocked && <p className="text-muted-foreground">{blockedReason}</p>}
          </CardFooter>
        )}
      </Card>
    </li>
  );
}
