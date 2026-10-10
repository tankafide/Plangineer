import { PlanEditInput, type PlanWorkspace } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure, rpcError } from '@/test/fixtures';
import {
  answerPlanWorkspace,
  planBodyFixture,
  planRevisionFixture,
  planWorkspaceFixture,
} from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

const STEPS_ONLY: PlanWorkspace['sections'] = [{ section: 'steps', status: 'complete' }];

/** Serves plan.get from a workspace that each answered edit replaces, as the API stores it. */
function servePlan(workspace: PlanWorkspace) {
  let current = workspace;
  answerPlanWorkspace(() => answerJson(current)());
  return {
    /** Stores the edit as the next revision and answers with it. */
    store: (input: unknown) => {
      const edit = PlanEditInput.parse(input);
      current = planWorkspaceFixture({
        sections: STEPS_ONLY,
        revision: planRevisionFixture({ number: edit.revision + 1, body: edit.body }),
      });
      return answerJson(current)();
    },
  };
}

async function renderSteps() {
  await renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
  return screen.findByRole('list', { name: 'Steps' });
}

const stepTitles = (list: HTMLElement) =>
  within(list)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent);

/** The card of the step at this position, named by its heading such as `1. Step 1`. */
const stepCard = (list: HTMLElement, number: number) =>
  within(list).getByRole('listitem', { name: new RegExp(`^${number}\\. `) });

const editedTitles = (input: unknown) =>
  PlanEditInput.parse(input).body.steps.map((step) => step.title);

describe('StepList', () => {
  it('shows a moved step before the save answers, and saves the swapped order', async () => {
    const { promise: answered, resolve: answerEdit } = Promise.withResolvers<void>();
    const plan = servePlan(planWorkspaceFixture({ sections: STEPS_ONLY }));
    const edits = answerProcedure('plan/edit', async () => {
      await answered;
      return plan.store(edits.at(-1));
    });
    const list = await renderSteps();

    await userEvent.click(within(stepCard(list, 1)).getByRole('button', { name: 'Move down' }));

    expect(stepTitles(list)).toEqual(['1. Step 2', '2. Step 1']);
    await vi.waitFor(() => expect(edits).toHaveLength(1));
    expect(editedTitles(edits[0])).toEqual(['Step 2', 'Step 1']);
    answerEdit();
    await vi.waitFor(() => expect(screen.getByText('Revision 2')).toBeTruthy());
    expect(stepTitles(list)).toEqual(['1. Step 2', '2. Step 1']);
  });

  it('saves two quick moves one after the other, each on the newest revision', async () => {
    const plan = servePlan(planWorkspaceFixture({ sections: STEPS_ONLY }));
    const edits = answerProcedure('plan/edit', () => plan.store(edits.at(-1)));
    const list = await renderSteps();
    const moveDownFirst = () =>
      userEvent.click(within(stepCard(list, 1)).getByRole('button', { name: 'Move down' }));

    await moveDownFirst();
    await moveDownFirst();

    await vi.waitFor(() => expect(edits).toHaveLength(2));
    expect(edits.map((input) => PlanEditInput.parse(input).revision)).toEqual([1, 2]);
    expect(editedTitles(edits[1])).toEqual(['Step 1', 'Step 2']);
    expect(await screen.findByText('Revision 3')).toBeTruthy();
    expect(stepTitles(list)).toEqual(['1. Step 1', '2. Step 2']);
  });

  it('puts the old order back when the save fails', async () => {
    servePlan(planWorkspaceFixture({ sections: STEPS_ONLY }));
    answerProcedure('plan/edit', rpcError('INTERNAL_SERVER_ERROR', 500));
    const list = await renderSteps();

    await userEvent.click(within(stepCard(list, 1)).getByRole('button', { name: 'Move down' }));

    expect(await screen.findByText('The action failed.')).toBeTruthy();
    expect(stepTitles(list)).toEqual(['1. Step 1', '2. Step 2']);
  });

  it('marks a done-when line with no tick Uncovered, and names the ticks of a covered one', async () => {
    const body = planBodyFixture();
    const [first, second] = body.coverage;
    if (first === undefined || second === undefined) throw new Error('The fixture has two rows');
    answerPlanWorkspace(
      answerJson(
        planWorkspaceFixture({
          sections: STEPS_ONLY,
          revision: planRevisionFixture({
            body: {
              ...body,
              coverage: [
                { ...first, ticks: [] },
                { ...second, ticks: ['unit', 'end_to_end'] },
              ],
            },
          }),
        }),
      ),
    );
    const list = await renderSteps();

    const stepOne = within(stepCard(list, 1));
    const stepTwo = within(stepCard(list, 2));
    expect(stepOne.getByText('1a. Step 1 works.')).toBeTruthy();
    expect(stepOne.getByText('Uncovered')).toBeTruthy();
    expect(stepTwo.queryByText('Uncovered')).toBeNull();
    expect(stepTwo.getByText('Covered by Unit, End to end')).toBeTruthy();
  });
});
