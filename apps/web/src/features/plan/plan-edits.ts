import { CoverageColumn, type CoverageRow, type PlanBody } from '@plangineer/contracts';
import { alignCoverage } from '@plangineer/domain';

/** A step's fields as the step form saves them. A done-when line with a null id is new. */
export interface StepFields {
  title: string;
  files: string[];
  body: string;
  doneWhen: { id: string | null; text: string }[];
}

/** Moves the step at index `from` to index `to`, keeping the others in order. */
export function moveStep(body: PlanBody, from: number, to: number): PlanBody {
  const moved = body.steps[from];
  if (moved === undefined || to < 0 || to >= body.steps.length) {
    throw new Error(`Cannot move step ${from} to ${to} in a plan of ${body.steps.length} steps`);
  }
  const steps = body.steps.toSpliced(from, 1).toSpliced(to, 0, moved);
  return { ...body, steps };
}

/**
 * Replaces one step's fields. A new done-when line gets a fresh id, and the coverage gains a row
 * for it and drops the row of a removed line, so the body still passes `PlanBody`.
 */
export function replaceStepBody(body: PlanBody, stepId: string, fields: StepFields): PlanBody {
  if (!body.steps.some((step) => step.id === stepId)) {
    throw new Error(`The plan has no step ${stepId}`);
  }
  const steps = body.steps.map((step) =>
    step.id === stepId
      ? {
          ...step,
          title: fields.title,
          files: fields.files,
          body: fields.body,
          doneWhen: fields.doneWhen.map((line) => ({
            id: line.id ?? crypto.randomUUID(),
            text: line.text,
          })),
        }
      : step,
  );
  return alignCoverage({ ...body, steps });
}

function updateRow(
  body: PlanBody,
  lineId: string,
  update: (row: CoverageRow) => CoverageRow,
): PlanBody {
  if (!body.coverage.some((row) => row.lineId === lineId)) {
    throw new Error(`The plan has no coverage row for line ${lineId}`);
  }
  const coverage = body.coverage.map((row) => (row.lineId === lineId ? update(row) : row));
  return { ...body, coverage };
}

/** Sets a coverage row's ticks, kept in the grid's column order. */
export function setCoverageTicks(
  body: PlanBody,
  lineId: string,
  ticks: readonly CoverageColumn[],
): PlanBody {
  const ticked = new Set(ticks);
  return updateRow(body, lineId, (row) => ({
    ...row,
    ticks: CoverageColumn.options.filter((column) => ticked.has(column)),
  }));
}

/** Marks a stale coverage row checked by the engineer. */
export function clearStale(body: PlanBody, lineId: string): PlanBody {
  return updateRow(body, lineId, (row) => ({ ...row, stale: false }));
}
