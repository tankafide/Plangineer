import { type CoverageRow, PlanEditInput } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure } from '@/test/fixtures';
import {
  answerPlanWorkspace,
  planBodyFixture,
  planRevisionFixture,
  planWorkspaceFixture,
} from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

const BODY = planBodyFixture();
const [LINE_1A, LINE_2A] = BODY.coverage.map((row) => row.lineId);

/** Renders the test plan with these coverage rows, and returns the desktop grid. */
async function renderGrid(coverage: CoverageRow[]) {
  answerPlanWorkspace(
    answerJson(
      planWorkspaceFixture({
        sections: [{ section: 'test_plan', status: 'complete' }],
        revision: planRevisionFixture({ body: { ...BODY, coverage } }),
      }),
    ),
  );
  await renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
  return within(await screen.findByRole('table'));
}

const editedCoverage = (input: unknown) => PlanEditInput.parse(input).body.coverage;

describe('CoverageGrid', () => {
  it('saves two ticks in one plan.edit', async () => {
    const edits = answerProcedure('plan/edit', answerJson(planWorkspaceFixture()));
    const grid = await renderGrid(BODY.coverage);
    const save = screen.getByRole('button', { name: 'Save coverage' });
    expect(save.hasAttribute('disabled')).toBe(true);

    await userEvent.click(grid.getByRole('checkbox', { name: '1a: Integration' }));
    await userEvent.click(grid.getByRole('checkbox', { name: '2a: Agent check' }));
    await userEvent.click(save);

    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(editedCoverage(edits[0])).toEqual([
      { lineId: LINE_1A, ticks: ['unit', 'integration'], stale: false },
      { lineId: LINE_2A, ticks: ['unit', 'agent_check'], stale: false },
    ]);
  });

  it('marks a stale row checked and saves it with stale cleared', async () => {
    const edits = answerProcedure('plan/edit', answerJson(planWorkspaceFixture()));
    const grid = await renderGrid(
      BODY.coverage.map((row) => (row.lineId === LINE_1A ? { ...row, stale: true } : row)),
    );
    const staleRow = within(grid.getByRole('row', { name: /1a\. Step 1 works\./ }));
    expect(staleRow.getByText('Stale')).toBeTruthy();

    await userEvent.click(staleRow.getByRole('button', { name: 'Mark checked' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save coverage' }));

    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(editedCoverage(edits[0])).toEqual(BODY.coverage);
  });

  it('shows Gap on a row with no tick', async () => {
    const grid = await renderGrid(
      BODY.coverage.map((row) => (row.lineId === LINE_2A ? { ...row, ticks: [] } : row)),
    );

    expect(
      within(grid.getByRole('row', { name: /2a\. Step 2 works\./ })).getByText('Gap'),
    ).toBeTruthy();
    expect(
      within(grid.getByRole('row', { name: /1a\. Step 1 works\./ })).queryByText('Gap'),
    ).toBeNull();
  });

  it('shows each row as a card with labelled ticks on a phone', async () => {
    await renderGrid(BODY.coverage);

    const cards = screen.getByRole('list', { name: 'Test rows' });
    expect(within(cards).getAllByRole('checkbox')).toHaveLength(12);
    expect(within(cards).getByText('1a. Step 1 works.')).toBeTruthy();
  });
});
