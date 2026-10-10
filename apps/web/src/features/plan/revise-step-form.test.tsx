import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure } from '@/test/fixtures';
import { answerPlanWorkspace, planBodyFixture, planWorkspaceFixture } from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

describe('ReviseStepForm', () => {
  it('sends plan.reviseStep with the step id and the instruction', async () => {
    answerPlanWorkspace(
      answerJson(planWorkspaceFixture({ sections: [{ section: 'steps', status: 'complete' }] })),
    );
    const revisions = answerProcedure('plan/reviseStep', answerJson(planWorkspaceFixture()));
    await renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
    const list = await screen.findByRole('list', { name: 'Steps' });
    const [, askAboutStepTwo] = within(list).getAllByRole('button', { name: 'Ask the agent' });
    if (askAboutStepTwo === undefined) throw new Error('Step 2 has no Ask the agent button');

    await userEvent.click(askAboutStepTwo);
    await userEvent.type(
      screen.getByRole('textbox', { name: 'What should the agent change?' }),
      'Split the export into pages',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send to agent' }));

    await vi.waitFor(() =>
      expect(revisions).toEqual([
        {
          featureId: FEATURE_ID,
          revision: 1,
          stepId: planBodyFixture().steps[1]?.id,
          instruction: 'Split the export into pages',
        },
      ]),
    );
  });
});
