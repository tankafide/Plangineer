import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure, rpcError } from '@/test/fixtures';
import { planConflict, planWorkspaceFixture } from '@/test/plan-fixtures';
import { SectionCard } from './section-card';

function renderCard(blockedReason: string | null = null) {
  return renderPage(() => (
    <SectionCard featureId={FEATURE_ID} revision={3} section="goal" blockedReason={blockedReason}>
      <p>Export invoices as CSV.</p>
    </SectionCard>
  ));
}

describe('SectionCard', () => {
  it.each([
    ['Expand', 'expand'],
    ['Simplify', 'simplify'],
    ['Regenerate', 'regenerate'],
  ])('%s sends plan.sectionAction with the section and the action', async (label, action) => {
    const actions = answerProcedure('plan/sectionAction', answerJson(planWorkspaceFixture()));
    await renderCard();

    await userEvent.click(await screen.findByRole('button', { name: `${label} Goal` }));

    await vi.waitFor(() =>
      expect(actions).toEqual([{ featureId: FEATURE_ID, revision: 3, section: 'goal', action }]),
    );
  });

  it('disables the actions with the reason while the plan cannot change', async () => {
    await renderCard('The agent is still working on this plan.');

    expect(
      (await screen.findByRole('button', { name: 'Expand Goal' })).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByText('The agent is still working on this plan.')).toBeTruthy();
  });

  it('shows a turn_running conflict in the card', async () => {
    answerProcedure('plan/sectionAction', planConflict('turn_running'));
    await renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Expand Goal' }));

    const card = document.getElementById('section-goal');
    if (card === null) throw new Error('The goal card is not on screen');
    expect(await within(card).findByText('The agent is still working on this plan.')).toBeTruthy();
  });

  it('shows RUNNER_REQUIRED in the card with a link to Runners', async () => {
    answerProcedure('plan/sectionAction', rpcError('RUNNER_REQUIRED', 409));
    await renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Simplify Goal' }));

    const card = document.getElementById('section-goal');
    if (card === null) throw new Error('The goal card is not on screen');
    expect(await within(card).findByText(/No runner is online to run the agent\./)).toBeTruthy();
    expect(within(card).getByRole('link', { name: 'Runners' }).getAttribute('href')).toBe(
      '/runners',
    );
  });

  it('offers Retry after any other failure, which sends the action again', async () => {
    const actions = answerProcedure(
      'plan/sectionAction',
      rpcError('INTERNAL_SERVER_ERROR', 500),
      answerJson(planWorkspaceFixture()),
    );
    await renderCard();
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate Goal' }));
    expect(await screen.findByText('The action failed.')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => expect(actions).toHaveLength(2));
    expect(actions[1]).toEqual(actions[0]);
  });
});
