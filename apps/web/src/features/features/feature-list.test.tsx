import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage, renderRoute } from '@/test/app-harness';
import { FEATURE_ID, featureSummaryFixture } from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  answerSignedIn,
  neverAnswers,
  page,
  rpcError,
} from '@/test/fixtures';
import { FeatureList } from './feature-list';

const OTHER_FEATURE_ID = '0199c1a6-4444-7d4e-8f90-a1b2c3d4e5f7';

describe('Features screen', () => {
  it("lists the viewer's features with their state badges under a New feature button", async () => {
    answerSignedIn();
    answerProcedure(
      'feature/list',
      answerJson(
        page([
          featureSummaryFixture(),
          featureSummaryFixture({
            id: OTHER_FEATURE_ID,
            title: 'Dark mode toggle',
            state: 'plan_ready',
          }),
        ]),
      ),
    );

    await renderRoute('/features');

    const main = within(await screen.findByRole('main'));
    expect(main.getByRole('heading', { name: 'Features' })).toBeTruthy();
    expect(main.getAllByRole('link', { name: 'New feature' })[0]?.getAttribute('href')).toBe(
      '/features/new',
    );
    const list = await screen.findByRole('list', { name: 'Your features' });
    const rows = within(list).getAllByRole('link');
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([
      `/features/${FEATURE_ID}`,
      `/features/${OTHER_FEATURE_ID}`,
    ]);
    expect(rows[0]?.textContent).toContain('Export invoices as CSV');
    expect(rows[0]?.textContent).toContain('Pre-planning');
    expect(rows[1]?.textContent).toContain('Plan ready');
  });
});

describe('FeatureList', () => {
  it('shows a skeleton while the features load', async () => {
    answerProcedure('feature/list', neverAnswers);

    await renderPage(FeatureList);

    expect(await screen.findByRole('status', { name: 'Loading features' })).toBeTruthy();
  });

  it('shows No features yet with New feature when there are none', async () => {
    answerProcedure('feature/list', answerJson(page([])));

    await renderPage(FeatureList);

    expect(await screen.findByText('No features yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New feature' }).getAttribute('href')).toBe(
      '/features/new',
    );
  });

  it('shows the error and Retry when the features fail to load, and loads them on Retry', async () => {
    answerProcedure(
      'feature/list',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([featureSummaryFixture()])),
    );
    await renderPage(FeatureList);

    expect(await screen.findByText('Features could not be loaded')).toBeTruthy();
    expect(screen.getByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: /Export invoices as CSV/ })).toBeTruthy();
  });

  it('keeps the features on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'feature/list',
      answerJson(page([featureSummaryFixture({ state: 'plan_ready' })])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderPage(FeatureList);
    await screen.findByRole('link', { name: /Export invoices as CSV/ });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Export invoices as CSV/ })).toBeTruthy();
  });
});
