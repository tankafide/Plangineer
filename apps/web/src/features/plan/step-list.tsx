import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEditPlan } from '@plangineer/api-client';
import type { PlanBody } from '@plangineer/contracts';
import { acceptanceCriteria } from '@plangineer/domain';
import { PlanActionError } from './plan-action-error';
import { moveStep } from './plan-edits';
import { type LineCoverage, StepCard } from './step-card';

/** Each done-when line's label and ticks, read from the body so a moved step relabels at once. */
function lineCoverage(body: PlanBody): ReadonlyMap<string, LineCoverage> {
  const ticks = new Map(body.coverage.map((row) => [row.lineId, row.ticks]));
  return new Map(
    acceptanceCriteria(body).map((criterion) => {
      const lineTicks = ticks.get(criterion.lineId);
      if (lineTicks === undefined) {
        throw new Error(`Done-when line ${criterion.lineId} has no coverage row`);
      }
      return [criterion.lineId, { label: criterion.label, ticks: lineTicks }];
    }),
  );
}

/**
 * The plan's steps, reordered by drag or by each card's Move buttons. A move saves the new
 * order at once and shows it before the answer, and a failed save puts the old order back.
 */
export function StepList({
  featureId,
  revision,
  body,
  blockedReason,
}: {
  featureId: string;
  revision: number;
  body: PlanBody;
  blockedReason: string | null;
}) {
  const edit = useEditPlan(featureId);
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(TouchSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const coverage = lineCoverage(body);
  const move = (from: number, to: number) => edit.mutate({ body: moveStep(body, from, to) });
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over === null || active.id === over.id) return;
    const ids = body.steps.map((step) => step.id);
    move(ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  return (
    <div className="flex flex-col gap-3">
      {edit.isError && (
        <PlanActionError error={edit.error} onRetry={() => edit.mutate(edit.variables)} />
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext
          items={body.steps.map((step) => step.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol aria-label="Steps" className="flex flex-col gap-3">
            {body.steps.map((step, index) => (
              <StepCard
                key={step.id}
                featureId={featureId}
                revision={revision}
                body={body}
                step={step}
                number={index + 1}
                coverage={coverage}
                blockedReason={blockedReason}
                onMove={(offset) => move(index, index + offset)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}
