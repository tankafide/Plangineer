import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { renderPage, renderRoute } from '@/test/app-harness';
import { FEATURE_ID, featureFixture } from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  answerSignedIn,
  neverAnswers,
  page,
  REPOSITORY_ID,
  repositorySummaryFixture,
  rpcError,
} from '@/test/fixtures';
import { IntakeScreen } from './intake-screen';

const OTHER_REPOSITORY_ID = '0199c1a4-2222-7d4e-8f90-a1b2c3d4e5f7';

function answerOneRepository() {
  answerProcedure('repository/list', answerJson(page([repositorySummaryFixture()])));
}

function errorOf(field: HTMLElement): string | undefined {
  const ids = (field.getAttribute('aria-describedby') ?? '').split(' ');
  return ids
    .map((id) => document.getElementById(id))
    .find((element) => element?.getAttribute('role') === 'alert')?.textContent;
}

async function choose(label: string, option: string) {
  await userEvent.click(await screen.findByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('IntakeScreen form', () => {
  it('sends feature.create with the intake and opens the new feature', async () => {
    answerSignedIn();
    answerOneRepository();
    answerProcedure('feature/list', answerJson(page([])));
    const creates = answerProcedure('feature/create', answerJson(featureFixture()));
    answerProcedure('feature/get', answerJson(featureFixture()));
    const { router } = await renderRoute('/features/new');
    const notes = new File(['# Notes\n'], 'notes.md', { type: 'text/markdown' });

    await userEvent.type(
      await screen.findByLabelText('Description'),
      'Export invoices as CSV from the billing page.',
    );
    await userEvent.type(screen.getByLabelText('Ticket link'), 'https://acme.atlassian.net/T-1');
    await userEvent.upload(screen.getByLabelText('Attachments'), notes);
    await userEvent.type(
      screen.getByLabelText('Research topics'),
      'CSV injection\n\nExcel date formats',
    );
    await choose('Run mode', 'Manual plan');
    await userEvent.click(screen.getByRole('button', { name: 'Start feature' }));

    expect(await screen.findByRole('heading', { name: 'Export invoices as CSV' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/features/${FEATURE_ID}`);
    expect(creates).toHaveLength(1);
    const [input] = creates;
    expect(input).toEqual({
      description: 'Export invoices as CSV from the billing page.',
      ticketUrl: 'https://acme.atlassian.net/T-1',
      attachments: [expect.any(File)],
      exploreCodebase: true,
      researchTopics: ['CSV injection', 'Excel date formats'],
      runMode: 'manual_plan',
      repositoryIds: [REPOSITORY_ID],
    });
    const sent = z.object({ attachments: z.array(z.file()) }).parse(input).attachments[0];
    expect(sent?.name).toBe('notes.md');
    expect(sent?.type).toBe('text/markdown');
    expect(await sent?.text()).toBe('# Notes\n');
  });

  it('hides the repository select when one repository is configured, and presets its run mode', async () => {
    answerProcedure(
      'repository/list',
      answerJson(page([repositorySummaryFixture({ defaultRunMode: 'auto_loop' })])),
    );

    await renderPage(IntakeScreen);

    await screen.findByLabelText('Description');
    expect(screen.queryByRole('combobox', { name: 'Repository' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Run mode' }).textContent).toMatch(/^Auto loop/);
    expect(screen.getByText('Agents take the feature to an open pull request.')).toBeTruthy();
  });

  it("presets the run mode to the chosen repository's default", async () => {
    answerProcedure(
      'repository/list',
      answerJson(
        page([
          repositorySummaryFixture(),
          repositorySummaryFixture({
            id: OTHER_REPOSITORY_ID,
            name: 'api',
            defaultRunMode: 'auto_loop',
          }),
        ]),
      ),
    );
    await renderPage(IntakeScreen);

    await choose('Repository', 'acme/api');

    expect(screen.getByRole('combobox', { name: 'Run mode' }).textContent).toMatch(/^Auto loop/);
    expect(screen.getByText('Agents take the feature to an open pull request.')).toBeTruthy();
    await choose('Repository', 'acme/web-app');
    expect(screen.getByRole('combobox', { name: 'Run mode' }).textContent).not.toContain('plan');
    expect(screen.getByText('You decide at every stop point.')).toBeTruthy();
  });

  it('rejects an eleventh attachment, a non-https ticket link and an empty description', async () => {
    answerOneRepository();
    const creates = answerProcedure('feature/create', answerJson(featureFixture()));
    await renderPage(IntakeScreen);
    const files = Array.from(
      { length: 11 },
      (_, index) => new File(['shot'], `shot-${index + 1}.png`, { type: 'image/png' }),
    );

    await userEvent.upload(await screen.findByLabelText('Attachments'), files);
    await userEvent.type(screen.getByLabelText('Ticket link'), 'http://acme.example/T-1');
    await userEvent.click(screen.getByRole('button', { name: 'Start feature' }));

    await waitFor(() =>
      expect(errorOf(screen.getByLabelText('Description'))).toBe('Describe the feature.'),
    );
    expect(errorOf(screen.getByLabelText('Ticket link'))).toBe(
      'Enter an https link to the ticket.',
    );
    expect(errorOf(screen.getByLabelText('Attachments'))).toBe('Attach at most 10 files.');
    expect(creates).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove shot-11.png' }));
    expect(errorOf(screen.getByLabelText('Attachments'))).toBeUndefined();
  });

  it('shows an alert linking to Runners when no runner can take the feature', async () => {
    answerOneRepository();
    answerProcedure('feature/create', rpcError('RUNNER_REQUIRED', 409));
    await renderPage(IntakeScreen);

    await userEvent.type(await screen.findByLabelText('Description'), 'Export invoices.');
    await userEvent.click(screen.getByRole('button', { name: 'Start feature' }));

    expect(await screen.findByText(/No runner can take this feature/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Runners' }).getAttribute('href')).toBe('/runners');
  });
});

describe('IntakeScreen states', () => {
  it('shows a skeleton while the repositories load', async () => {
    answerProcedure('repository/list', neverAnswers);

    await renderPage(IntakeScreen);

    expect(await screen.findByRole('status', { name: 'Loading repositories' })).toBeTruthy();
    expect(screen.queryByLabelText('Description')).toBeNull();
  });

  it('shows the error and Retry when the repositories fail to load', async () => {
    answerProcedure(
      'repository/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([repositorySummaryFixture()])),
    );
    await renderPage(IntakeScreen);

    expect(await screen.findByText('Repositories could not be loaded')).toBeTruthy();
    expect(screen.getByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText('Description')).toBeTruthy();
  });

  it('keeps the form on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'repository/list',
      answerJson(page([repositorySummaryFixture()])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderPage(IntakeScreen);
    await screen.findByLabelText('Description');

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
  });

  it('shows Empty with a link to Repositories when no repository is configured', async () => {
    answerProcedure('repository/list', answerJson(page([])));

    await renderPage(IntakeScreen);

    expect(await screen.findByText('Add a repository before starting a feature.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to Repositories' }).getAttribute('href')).toBe(
      '/repositories',
    );
    expect(screen.queryByLabelText('Description')).toBeNull();
  });
});
