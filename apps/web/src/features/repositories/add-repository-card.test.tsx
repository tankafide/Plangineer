import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  INSTALL_URL,
  installableFixture,
  neverAnswers,
  repositoryFixture,
  rpcError,
} from '@/test/fixtures';
import { AddRepositoryCard } from './add-repository-card';

function answerInstallable(...responses: Array<() => Response | Promise<Response>>) {
  return answerProcedure('repository/listInstallable', ...responses);
}

const INSTALLABLE = answerJson({
  items: [installableFixture(), installableFixture({ githubRepositoryId: 43, name: 'api' })],
  truncated: false,
  installUrl: INSTALL_URL,
});

async function fillForm(description: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Repository' }));
  await userEvent.click(await screen.findByRole('option', { name: 'acme/api' }));
  await userEvent.type(screen.getByLabelText('Description'), description);
}

describe('AddRepositoryCard', () => {
  it('shows a skeleton while the installable repositories load', async () => {
    answerInstallable(neverAnswers);

    await renderPage(AddRepositoryCard);

    expect(
      await screen.findByRole('status', { name: 'Loading repositories on GitHub' }),
    ).toBeTruthy();
  });

  it('shows the GitHub error and Retry when the installable list fails', async () => {
    answerInstallable(rpcError('GITHUB_FAILED', 502, 'GitHub is down'), INSTALLABLE);
    await renderPage(AddRepositoryCard);

    expect((await screen.findByRole('alert')).textContent).toContain('GitHub is down');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('combobox', { name: 'Repository' })).toBeTruthy();
  });

  it('links to installing the App on GitHub when nothing is installable', async () => {
    answerInstallable(answerJson({ items: [], truncated: false, installUrl: INSTALL_URL }));

    await renderPage(AddRepositoryCard);

    expect(
      await screen.findByText(
        'Give Plangineer access to a repository on GitHub, then come back here.',
      ),
    ).toBeTruthy();
    const install = screen.getByRole('link', { name: 'Install on GitHub' });
    expect(install.getAttribute('href')).toBe(INSTALL_URL);
    expect(screen.queryByRole('combobox', { name: 'Repository' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add repository' })).toBeNull();
  });

  it('links to choosing more repositories on GitHub under the select', async () => {
    answerInstallable(INSTALLABLE);

    await renderPage(AddRepositoryCard);

    await screen.findByRole('combobox', { name: 'Repository' });
    const choose = screen.getByRole('link', { name: 'Choose repositories on GitHub' });
    expect(choose.getAttribute('href')).toBe(INSTALL_URL);
    expect(screen.queryByRole('link', { name: 'Install on GitHub' })).toBeNull();
  });

  it('adds the chosen repository with its description, then clears the form', async () => {
    answerInstallable(INSTALLABLE);
    const adds = answerProcedure('repository/add', answerJson(repositoryFixture()));
    await renderPage(AddRepositoryCard);
    await fillForm('  The API.  ');

    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));

    await screen.findByRole('button', { name: 'Add repository' });
    expect(adds).toEqual([{ githubRepositoryId: 43, description: 'The API.' }]);
    expect(screen.getByLabelText<HTMLTextAreaElement>('Description').value).toBe('');
  });

  it('asks for a repository and a description before adding', async () => {
    answerInstallable(INSTALLABLE);
    const adds = answerProcedure('repository/add', answerJson(repositoryFixture()));
    await renderPage(AddRepositoryCard);
    await screen.findByRole('combobox', { name: 'Repository' });

    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));

    expect(await screen.findByText('Choose a repository.')).toBeTruthy();
    expect(screen.getByText('Describe the repository.')).toBeTruthy();
    expect(adds).toEqual([]);
  });

  it('says so under the button when the repository is already added', async () => {
    answerInstallable(INSTALLABLE);
    answerProcedure('repository/add', rpcError('CONFLICT', 409));
    await renderPage(AddRepositoryCard);
    await fillForm('The API.');

    await userEvent.click(screen.getByRole('button', { name: 'Add repository' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'That repository is already added.',
    );
  });
});
