import type { RepositoryDetail } from '@plangineer/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { answerJson, answerProcedure, repositoryFixture, rpcError } from '@/test/fixtures';
import { RepositorySettingsCard } from './repository-settings-card';

function renderCard(repository: RepositoryDetail = repositoryFixture(), isAdmin = true) {
  return renderPage(() => <RepositorySettingsCard repository={repository} isAdmin={isAdmin} />);
}

function review(name: string) {
  return within(screen.getByRole('group', { name }));
}

async function choose(scope: ReturnType<typeof review>, label: string, option: string) {
  await userEvent.click(scope.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('RepositorySettingsCard', () => {
  it('shows a round count only for Fixed and Adaptive rounds', async () => {
    await renderCard();
    const planReview = review('Plan review');
    expect(planReview.queryByRole('spinbutton')).toBeNull();

    await choose(planReview, 'Rounds', 'Fixed');
    expect(planReview.getByRole('spinbutton', { name: 'Number of rounds' })).toBeTruthy();

    await choose(planReview, 'Rounds', 'Adaptive');
    expect(planReview.getByRole('spinbutton', { name: 'Most rounds' })).toBeTruthy();

    await choose(planReview, 'Rounds', 'Ask me');
    expect(planReview.queryByRole('spinbutton')).toBeNull();
  });

  it('saves the description, a model and the workflow settings, with an empty model as null', async () => {
    const repository = repositoryFixture({
      roleSettings: {
        ...repositoryFixture().roleSettings,
        verification: { ...repositoryFixture().roleSettings.verification, model: 'old-model' },
      },
    });
    const updates = answerProcedure('repository/update', answerJson(repository));
    await renderCard(repository);

    const description = screen.getByLabelText('Description');
    await userEvent.clear(description);
    await userEvent.type(description, 'The new web app.');
    await userEvent.type(screen.getByLabelText('Planning model'), 'claude-opus-4');
    await userEvent.clear(screen.getByLabelText('Verification model'));
    await choose(within(document.body), 'Plan check-in', 'Skip');
    await choose(review('Plan review'), 'Findings', 'Fix all');
    await choose(review('Plan review'), 'Rounds', 'Fixed');
    await userEvent.clear(screen.getByRole('spinbutton', { name: 'Number of rounds' }));
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Number of rounds' }), '3');
    await choose(review('Implementation review'), 'Rounds', 'Adaptive');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const roleSettings = repositoryFixture().roleSettings;
    await waitFor(() =>
      expect(updates).toEqual([
        {
          repositoryId: repository.id,
          description: 'The new web app.',
          roleSettings: {
            ...roleSettings,
            planning: { ...roleSettings.planning, model: 'claude-opus-4' },
            verification: { ...roleSettings.verification, model: null },
          },
          workflowSettings: {
            planCheckIn: 'skip',
            planReview: { findings: 'fix_all', rounds: { mode: 'fixed', count: 3 } },
            implementationReview: { findings: 'ask', rounds: { mode: 'adaptive', max: 1 } },
          },
        },
      ]),
    );
  });

  it('blocks a round count outside 1 to 5 next to its field', async () => {
    const updates = answerProcedure('repository/update', answerJson(repositoryFixture()));
    await renderCard();
    await choose(review('Plan review'), 'Rounds', 'Fixed');
    const count = screen.getByRole('spinbutton', { name: 'Number of rounds' });
    await userEvent.clear(count);
    await userEvent.type(count, '6');

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a whole number from 1 to 5.')).toBeTruthy();
    expect(count.getAttribute('aria-invalid')).toBe('true');
    expect(updates).toEqual([]);
  });

  it('shows a save failure under Save', async () => {
    answerProcedure('repository/update', rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'));
    await renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The settings could not be saved: Database down',
    );
  });

  it('shows a member the settings as text, with no inputs or buttons', async () => {
    await renderCard(
      repositoryFixture({
        workflowSettings: {
          planCheckIn: 'pause',
          planReview: { findings: 'fix_all', rounds: { mode: 'fixed', count: 2 } },
          implementationReview: { findings: 'ask', rounds: { mode: 'adaptive', max: 4 } },
        },
      }),
      false,
    );

    expect(await screen.findByText('The customer web app.')).toBeTruthy();
    expect(screen.getByText('Pause for my confirmation')).toBeTruthy();
    expect(screen.getByText('Findings: Fix all. Rounds: Fixed, 2.')).toBeTruthy();
    expect(screen.getByText('Findings: Ask me. Rounds: Adaptive, up to 4.')).toBeTruthy();
    expect(screen.getAllByText('Default model')).toHaveLength(6);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
