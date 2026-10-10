import { useEditPlan } from '@plangineer/api-client';
import { CoverageColumn, type CoverageRow, type PlanBody } from '@plangineer/contracts';
import { acceptanceCriteria } from '@plangineer/domain';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PlanActionError } from './plan-action-error';
import { clearStale, setCoverageTicks } from './plan-edits';
import { COVERAGE_COLUMN_LABELS } from './plan-labels';

/** A coverage row with what it covers: a done-when line such as `1a` or a constraint. */
interface GridRow {
  row: CoverageRow;
  /** The short name each tick box carries, such as `1a`. */
  name: string;
  label: string;
}

function gridRows(body: PlanBody): GridRow[] {
  const lines = new Map<string, { name: string; label: string }>([
    ...acceptanceCriteria(body).map(
      (line) => [line.lineId, { name: line.label, label: `${line.label}. ${line.text}` }] as const,
    ),
    ...body.constraints.map(
      (constraint) => [constraint.id, { name: constraint.title, label: constraint.title }] as const,
    ),
  ]);
  return body.coverage.map((row) => {
    const line = lines.get(row.lineId);
    if (line === undefined) throw new Error(`Coverage row ${row.lineId} names no line`);
    return { row, ...line };
  });
}

const sameRow = (a: CoverageRow, b: CoverageRow | undefined) =>
  b !== undefined &&
  a.stale === b.stale &&
  a.ticks.length === b.ticks.length &&
  a.ticks.every((tick, index) => tick === b.ticks[index]);

interface RowActions {
  disabled: boolean;
  onTick: (row: CoverageRow, column: CoverageColumn, ticked: boolean) => void;
  onMarkChecked: (row: CoverageRow) => void;
}

function RowStatus({
  row,
  disabled,
  onMarkChecked,
}: { row: CoverageRow } & Omit<RowActions, 'onTick'>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {row.ticks.length === 0 && <Badge variant="warning">Gap</Badge>}
      {row.stale && (
        <>
          <Badge variant="warning">Stale</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => onMarkChecked(row)}
          >
            Mark checked
          </Button>
        </>
      )}
    </div>
  );
}

function TickBox({
  gridRow,
  column,
  disabled,
  onTick,
}: { gridRow: GridRow; column: CoverageColumn } & Pick<RowActions, 'disabled' | 'onTick'>) {
  return (
    <Checkbox
      className="after:-inset-3.5"
      aria-label={`${gridRow.name}: ${COVERAGE_COLUMN_LABELS[column]}`}
      checked={gridRow.row.ticks.includes(column)}
      disabled={disabled}
      onCheckedChange={(ticked) => onTick(gridRow.row, column, ticked)}
    />
  );
}

function CoverageTable({ rows, ...actions }: { rows: GridRow[] } & RowActions) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Line</TableHead>
          {CoverageColumn.options.map((column) => (
            <TableHead key={column} className="text-center">
              {COVERAGE_COLUMN_LABELS[column]}
            </TableHead>
          ))}
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((gridRow) => (
          <TableRow key={gridRow.row.lineId}>
            <TableCell className="min-w-48 whitespace-normal break-words">
              {gridRow.label}
            </TableCell>
            {CoverageColumn.options.map((column) => (
              <TableCell key={column} className="text-center">
                <span className="inline-flex size-11 items-center justify-center">
                  <TickBox gridRow={gridRow} column={column} {...actions} />
                </span>
              </TableCell>
            ))}
            <TableCell>
              <RowStatus row={gridRow.row} {...actions} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CoverageCards({ rows, ...actions }: { rows: GridRow[] } & RowActions) {
  return (
    <ul aria-label="Test rows" className="flex flex-col gap-3 md:hidden">
      {rows.map((gridRow) => (
        <li key={gridRow.row.lineId} className="flex min-w-0 flex-col gap-3 rounded-lg border p-3">
          <p className="break-words">{gridRow.label}</p>
          <RowStatus row={gridRow.row} {...actions} />
          <div className="grid grid-cols-2 gap-2">
            {CoverageColumn.options.map((column) => (
              <label key={column} className="flex min-h-11 items-center gap-3">
                <TickBox gridRow={gridRow} column={column} {...actions} />
                <span aria-hidden>{COVERAGE_COLUMN_LABELS[column]}</span>
              </label>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The test plan as a grid of done-when lines and constraints against the six test layers. Ticks
 * and Mark checked change a local copy, and Save coverage stores them as one revision (D8).
 */
export function CoverageGrid({
  featureId,
  body,
  blockedReason,
}: {
  featureId: string;
  body: PlanBody;
  blockedReason: string | null;
}) {
  const edit = useEditPlan(featureId);
  // The rows the engineer changed, by line, laid over the saved coverage.
  const [edits, setEdits] = useState<ReadonlyMap<string, CoverageRow>>(new Map());
  const draft: PlanBody = {
    ...body,
    coverage: body.coverage.map((row) => edits.get(row.lineId) ?? row),
  };
  const changed = draft.coverage.some((row, index) => !sameRow(row, body.coverage[index]));
  const keep = (next: PlanBody) =>
    setEdits(
      new Map(
        next.coverage
          .filter((row, index) => !sameRow(row, body.coverage[index]))
          .map((row) => [row.lineId, row]),
      ),
    );
  const blocked = blockedReason !== null;
  const actions: RowActions = {
    disabled: blocked || edit.isPending,
    onTick: (row, column, ticked) =>
      keep(
        setCoverageTicks(
          draft,
          row.lineId,
          ticked ? [...row.ticks, column] : row.ticks.filter((tick) => tick !== column),
        ),
      ),
    onMarkChecked: (row) => keep(clearStale(draft, row.lineId)),
  };
  const rows = gridRows(draft);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="hidden md:block">
        <CoverageTable rows={rows} {...actions} />
      </div>
      <CoverageCards rows={rows} {...actions} />
      {edit.isError && (
        <PlanActionError error={edit.error} onRetry={() => edit.mutate(edit.variables)} />
      )}
      <Button
        variant="outline"
        className="w-full md:w-auto md:self-start"
        disabled={!changed || blocked || edit.isPending}
        onClick={() => edit.mutate({ body: draft }, { onSuccess: () => setEdits(new Map()) })}
      >
        {edit.isPending ? 'Saving…' : 'Save coverage'}
      </Button>
    </div>
  );
}
