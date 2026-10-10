import type { CoverageRow, PlanBody, PlanStep } from '@plangineer/contracts';

/** Every done-when line id and then every constraint id, in plan order. */
function lineIds(body: PlanBody): string[] {
  return [
    ...body.steps.flatMap((step) => step.doneWhen.map((line) => line.id)),
    ...body.constraints.map((constraint) => constraint.id),
  ];
}

/**
 * One coverage row per done-when line and constraint, in plan order. A line with no row gets an
 * empty one, and a row naming no line is dropped.
 */
export function alignCoverage(body: PlanBody): PlanBody {
  const rows = new Map<string, CoverageRow>();
  for (const row of body.coverage) if (!rows.has(row.lineId)) rows.set(row.lineId, row);
  const coverage = lineIds(body).map(
    (lineId) => rows.get(lineId) ?? { lineId, ticks: [], stale: false },
  );
  return { ...body, coverage };
}

const sameStrings = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

function stepChanged(previous: PlanStep, next: PlanStep): boolean {
  return (
    previous.title !== next.title ||
    previous.body !== next.body ||
    !sameStrings(previous.files, next.files) ||
    !sameStrings(
      previous.doneWhen.map((line) => line.text),
      next.doneWhen.map((line) => line.text),
    )
  );
}

/**
 * Flags the coverage rows of every step that changed since the previous body, so the engineer
 * checks its tests again (D8). Every other row keeps its flag.
 */
export function markStale(previous: PlanBody | null, next: PlanBody): PlanBody {
  if (previous === null) return next;
  const before = new Map(previous.steps.map((step) => [step.id, step]));
  const staleLines = new Set(
    next.steps
      .filter((step) => {
        const earlier = before.get(step.id);
        return earlier !== undefined && stepChanged(earlier, step);
      })
      .flatMap((step) => step.doneWhen.map((line) => line.id)),
  );
  const coverage = next.coverage.map((row) =>
    staleLines.has(row.lineId) ? { ...row, stale: true } : row,
  );
  return { ...next, coverage };
}
