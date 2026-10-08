import type { RepositoryScan } from '@plangineer/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  page,
  REPOSITORY_ID,
  repositoryFixture,
  RUNNER_ID,
  runnerFixture,
  scanFixture,
  setupFixture,
} from '@/test/fixtures';
import { SetupCard } from './setup-card';

const ALL_ORCHESTRATORS = [
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
];

function renderChecklists(scan: RepositoryScan = scanFixture()) {
  answerProcedure('runner/list', answerJson(page([runnerFixture()])));
  const repository = repositoryFixture({ setup: setupFixture({ scan }) });
  return renderPage(() => <SetupCard repository={repository} isAdmin />);
}

/** A checkbox by name. Orchestrators come from their own group, since a scan may list one as a skill too. */
function checkbox(name: string) {
  const group = ALL_ORCHESTRATORS.includes(name)
    ? within(screen.getByRole('group', { name: 'Orchestrators' }))
    : screen;
  return group.getByRole('checkbox', { name });
}

function isChecked(name: string): boolean {
  return checkbox(name).getAttribute('aria-checked') === 'true';
}

function isDisabled(name: string): boolean {
  return checkbox(name).hasAttribute('data-disabled');
}

function notes(name: string): string {
  const id = checkbox(name).getAttribute('aria-describedby') ?? '';
  return document.getElementById(id)?.textContent ?? '';
}

describe('SetupChecklists', () => {
  it('ticks every existing skill and notes the ones that move', async () => {
    await renderChecklists();

    const group = within(await screen.findByRole('group', { name: 'Existing skills' }));
    expect(group.getAllByRole('checkbox')).toHaveLength(2);
    expect(isChecked('deploy')).toBe(true);
    expect(notes('deploy')).toBe('Ships the app.');
    expect(isChecked('legacy-notes')).toBe(true);
    expect(notes('legacy-notes')).toBe('Moves to .agents/skills');
  });

  it('ticks recommended skills with their reason and kind, and locks the required one', async () => {
    await renderChecklists();

    await screen.findByRole('group', { name: 'Skills to add' });
    expect(isChecked('testing')).toBe(true);
    expect(isDisabled('testing')).toBe(true);
    expect(notes('testing')).toBe(
      'Every repository needs itFilled in from your codeRequired by every setup',
    );
    expect(isChecked('frontend-react')).toBe(true);
    expect(notes('frontend-react')).toBe('Found react in package.jsonWritten from your code');
    expect(screen.getByText('react', { selector: 'code' }).tagName).toBe('CODE');
    expect(isChecked('persistence')).toBe(false);
    expect(notes('persistence')).toBe('No signal foundShips as written');
  });

  it('ticks the orchestrators and disables one already in the repository', async () => {
    await renderChecklists(
      scanFixture({
        skills: [{ name: 'plan-orchestrator', description: null, location: 'agents' }],
      }),
    );

    await screen.findByRole('group', { name: 'Orchestrators' });
    expect(isChecked('plan-orchestrator')).toBe(false);
    expect(isDisabled('plan-orchestrator')).toBe(true);
    expect(notes('plan-orchestrator')).toBe('Already in the repository');
    for (const name of ALL_ORCHESTRATORS.slice(1)) {
      expect(isChecked(name)).toBe(true);
      expect(isDisabled(name)).toBe(false);
    }
  });

  it('unlocks required skills once nothing else is ticked', async () => {
    await renderChecklists();
    await screen.findByRole('group', { name: 'Skills to add' });

    await userEvent.click(checkbox('frontend-react'));
    for (const name of ALL_ORCHESTRATORS.slice(0, -1)) await userEvent.click(checkbox(name));
    expect(isDisabled('testing')).toBe(true);
    await userEvent.click(checkbox(ALL_ORCHESTRATORS.at(-1) ?? ''));

    expect(isDisabled('testing')).toBe(false);
    expect(notes('testing')).toBe('Every repository needs itFilled in from your code');
  });

  it('sends the ticked names, with the locked required skill, to repositorySetup.start', async () => {
    const starts = answerProcedure('repositorySetup/start', answerJson(repositoryFixture()));
    await renderChecklists();
    await screen.findByRole('group', { name: 'Skills to add' });

    await userEvent.click(checkbox('deploy'));
    await userEvent.click(checkbox('persistence'));
    await userEvent.click(checkbox('plan-review-orchestrator'));
    await userEvent.click(screen.getByRole('combobox', { name: 'Runner' }));
    await userEvent.click(await screen.findByRole('option', { name: 'ada-laptop' }));
    await userEvent.click(screen.getByRole('button', { name: 'Generate pull request' }));

    await waitFor(() =>
      expect(starts).toEqual([
        {
          repositoryId: REPOSITORY_ID,
          runnerId: RUNNER_ID,
          selection: {
            reuseSkills: ['legacy-notes'],
            addSkills: ['testing', 'frontend-react', 'persistence'],
            orchestrators: [
              'plan-orchestrator',
              'implementation-orchestrator',
              'implementation-review-orchestrator',
            ],
          },
        },
      ]),
    );
  });
});
