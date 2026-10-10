import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderRoute } from '@/test/app-harness';
import { FEATURE_ID, featureFixture, featureSummaryFixture } from '@/test/feature-fixtures';
import { answerJson, answerProcedure, answerSignedIn, page, rpcError } from '@/test/fixtures';

const OTHER_FEATURE_ID = '0199c1a6-4444-7d4e-8f90-a1b2c3d4e5f7';

function answerTwoFeatures() {
  answerProcedure(
    'feature/list',
    answerJson(
      page([
        featureSummaryFixture({ state: 'plan_ready' }),
        featureSummaryFixture({ id: OTHER_FEATURE_ID, title: 'Dark mode toggle' }),
      ]),
    ),
  );
}

describe('FeatureTabs', () => {
  it("marks the open feature's tab as the current page, with a tab per feature and New feature", async () => {
    answerSignedIn();
    answerTwoFeatures();
    answerProcedure('feature/get', answerJson(featureFixture({ state: 'plan_ready' })));

    await renderRoute(`/features/${FEATURE_ID}`);

    const tabs = within(await screen.findByRole('navigation', { name: 'Features' }));
    const current = await tabs.findByRole('link', { name: /Export invoices as CSV/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(current.textContent).toContain('Plan ready');
    const other = tabs.getByRole('link', { name: /Dark mode toggle/ });
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.getAttribute('href')).toBe(`/features/${OTHER_FEATURE_ID}`);
    expect(tabs.getByRole('link', { name: 'New feature' }).getAttribute('href')).toBe(
      '/features/new',
    );
  });

  it('keeps the tab current on one of its context files', async () => {
    answerSignedIn();
    answerTwoFeatures();
    answerProcedure('contextFile/get', rpcError('NOT_FOUND', 404));

    await renderRoute(`/features/${FEATURE_ID}/files/${OTHER_FEATURE_ID}`);

    const tabs = within(await screen.findByRole('navigation', { name: 'Features' }));
    const current = await tabs.findByRole('link', { name: /Export invoices as CSV/ });
    expect(current.getAttribute('aria-current')).toBe('page');
  });

  it('says the tabs could not be loaded, with Retry', async () => {
    answerSignedIn();
    answerProcedure('feature/list', rpcError('INTERNAL_SERVER_ERROR', 500));
    answerProcedure('feature/get', answerJson(featureFixture()));

    await renderRoute(`/features/${FEATURE_ID}`);

    const tabs = within(await screen.findByRole('navigation', { name: 'Features' }));
    expect(await tabs.findByText('Your features could not be loaded.')).toBeTruthy();
    expect(tabs.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
