import { PlanBody, PlanEditInput } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure } from '@/test/fixtures';
import { answerPlanWorkspace, planBodyFixture, planWorkspaceFixture } from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

const STEP_ONE_LINE = planBodyFixture().steps[0]?.doneWhen[0]?.id;
const STEP_TWO_LINE = planBodyFixture().steps[1]?.doneWhen[0]?.id;

async function editStepOne() {
  answerPlanWorkspace(
    answerJson(planWorkspaceFixture({ sections: [{ section: 'steps', status: 'complete' }] })),
  );
  await renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
  const list = await screen.findByRole('list', { name: 'Steps' });
  const [editStep] = within(list).getAllByRole('button', { name: 'Edit' });
  if (editStep === undefined) throw new Error('No step has an Edit button');
  await userEvent.click(editStep);
  return within(screen.getByRole('form', { name: 'Edit step Step 1' }));
}

describe('StepForm', () => {
  it('saves a renamed step with one line added and one removed, with matching coverage', async () => {
    const edits = answerProcedure('plan/edit', answerJson(planWorkspaceFixture()));
    const form = await editStepOne();

    await userEvent.clear(form.getByRole('textbox', { name: 'Title' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Title' }), 'Write the CSV');
    await userEvent.click(form.getByRole('button', { name: 'Add line' }));
    await userEvent.type(form.getByRole('textbox', { name: 'Line 2' }), 'The file opens in Excel.');
    await userEvent.click(form.getByRole('button', { name: 'Remove line 1' }));
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    await vi.waitFor(() => expect(edits).toHaveLength(1));
    const { revision, body } = PlanEditInput.parse(edits[0]);
    const [stepOne] = body.steps;
    const [line] = stepOne?.doneWhen ?? [];
    expect(revision).toBe(1);
    expect(stepOne?.title).toBe('Write the CSV');
    expect(stepOne?.doneWhen.map((doneWhen) => doneWhen.text)).toEqual([
      'The file opens in Excel.',
    ]);
    expect(line?.id).not.toBe(STEP_ONE_LINE);
    expect(body.coverage).toEqual([
      { lineId: line?.id, ticks: [], stale: false },
      { lineId: STEP_TWO_LINE, ticks: ['unit'], stale: false },
    ]);
    expect(PlanBody.safeParse(body).success).toBe(true);
  });

  it('shows a field error for an empty title and sends nothing', async () => {
    const edits = answerProcedure('plan/edit', answerJson(planWorkspaceFixture()));
    const form = await editStepOne();

    await userEvent.clear(form.getByRole('textbox', { name: 'Title' }));
    await userEvent.click(form.getByRole('button', { name: 'Save' }));

    expect(await form.findByText('Enter a title.')).toBeTruthy();
    expect(form.getByRole('textbox', { name: 'Title' }).getAttribute('aria-invalid')).toBe('true');
    expect(edits).toEqual([]);
  });
});
