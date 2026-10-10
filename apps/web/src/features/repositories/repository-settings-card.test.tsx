import type { RepositoryDetail } from '@plangineer/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { answerJson, answerProcedure, repositoryFixture, rpcError } from '@/test/fixtures';
import { RepositorySettingsCard } from './repository-settings-card';

function renderCard(repository: RepositoryDetail = repositoryFixture(), isAdmin = true) {
  return renderPage(() => <RepositorySettingsCard repository={repository} isAdmin={isAdmin} />);
}

async function choose(label: string, option: string) {
  await userEvent.click(screen.getByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('RepositorySettingsCard', () => {
  it('saves the description, a model and the default run mode, with an empty model as null', async () => {
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
    await choose('Default run mode', 'Manual plan');
    expect(
      screen.getByText('You shape and approve the plan. Agents build and review the code.'),
    ).toBeTruthy();
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
          defaultRunMode: 'manual_plan',
        },
      ]),
    );
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
    await renderCard(repositoryFixture({ defaultRunMode: 'auto_loop' }), false);

    expect(await screen.findByText('The customer web app.')).toBeTruthy();
    expect(screen.getByText('Default run mode')).toBeTruthy();
    expect(screen.getByText('Auto loop')).toBeTruthy();
    expect(screen.getByText('Agents take the feature to an open pull request.')).toBeTruthy();
    expect(screen.getAllByText('Default model')).toHaveLength(6);
    expect(screen.queryAllByRole('textbox')).toEqual([]);
    expect(screen.queryAllByRole('combobox')).toEqual([]);
    expect(screen.queryAllByRole('button')).toEqual([]);
  });
});
