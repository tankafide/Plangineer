import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import {
  CONTEXT_FILE_ID,
  contextFileFixture,
  contextFileSummaryFixture,
  FEATURE_ID,
  featureFixture,
  taskFixture,
} from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  COMMIT,
  neverAnswers,
  RUN_ID,
  rpcError,
} from '@/test/fixtures';
import { FeatureScreen } from './feature-screen';

const EXPLORATION_RUN_ID = '0199c1a3-1111-7d4e-8f90-a1b2c3d4e5f7';
const RESEARCH_RUN_ID = '0199c1a3-1111-7d4e-8f90-a1b2c3d4e5f8';

function renderScreen() {
  return renderPage(() => <FeatureScreen featureId={FEATURE_ID} />);
}

const TASKS = [
  taskFixture({ status: 'succeeded', commit: COMMIT }),
  taskFixture({
    id: '0199c1a7-5555-7d4e-8f90-a1b2c3d4e5f7',
    kind: 'exploration',
    runId: EXPLORATION_RUN_ID,
    status: 'running',
    commit: COMMIT,
  }),
  taskFixture({
    id: '0199c1a7-5555-7d4e-8f90-a1b2c3d4e5f8',
    kind: 'research',
    topic: 'CSV injection',
    runId: RESEARCH_RUN_ID,
    status: 'queued',
  }),
];

afterEach(() => {
  vi.useRealTimers();
});

describe('FeatureScreen', () => {
  it("shows the ticket link, each task's kind, status and commit, and context files as they arrive", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ticketUrl = 'https://acme.atlassian.net/browse/T-1';
    answerProcedure(
      'feature/get',
      answerJson(featureFixture({ ticketUrl, tasks: TASKS })),
      answerJson(
        featureFixture({ ticketUrl, tasks: TASKS, contextFiles: [contextFileSummaryFixture()] }),
      ),
    );
    await renderScreen();

    expect((await screen.findByRole('link', { name: ticketUrl })).getAttribute('href')).toBe(
      ticketUrl,
    );
    const rows = within(screen.getByRole('list', { name: 'Tasks' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^IntakeSucceededacme\/web-app0123456789abView run$/),
      expect.stringMatching(/^ExplorationRunningacme\/web-app0123456789abView run$/),
      expect.stringMatching(/^ResearchQueuedCSV injectionView run$/),
    ]);
    expect(
      within(rows[2] ?? document.body)
        .getByRole('link', { name: 'View run' })
        .getAttribute('href'),
    ).toBe(`/runs/${RESEARCH_RUN_ID}`);
    expect(screen.getByText('Context files appear here as tasks finish.')).toBeTruthy();

    await act(() => vi.advanceTimersByTimeAsync(3_000));

    const files = within(await screen.findByRole('list', { name: 'Context files' }));
    expect(
      files.getByRole('checkbox', { name: 'Feature brief' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(files.getByRole('link', { name: 'Open Feature brief' }).getAttribute('href')).toBe(
      `/features/${FEATURE_ID}/files/${CONTEXT_FILE_ID}`,
    );
  });

  it('shows Start planning for a plan-ready Manual feature and moves it to Planning', async () => {
    answerProcedure('feature/get', answerJson(featureFixture({ state: 'plan_ready' })));
    const starts = answerProcedure(
      'feature/startPlanning',
      answerJson(featureFixture({ state: 'planning' })),
    );
    await renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Start planning' }));

    const title = screen.getByRole('heading', { name: 'Export invoices as CSV' });
    await waitFor(() => expect(title.parentElement?.textContent).toContain('Planning'));
    expect(starts).toEqual([{ featureId: FEATURE_ID }]);
    expect(screen.queryByRole('button', { name: 'Start planning' })).toBeNull();
  });

  it('says planning starts by itself, with no Start planning, for a plan-ready Auto loop feature', async () => {
    answerProcedure(
      'feature/get',
      answerJson(featureFixture({ state: 'plan_ready', runMode: 'auto_loop' })),
    );

    await renderScreen();

    expect(await screen.findByText('Planning starts by itself under Auto loop.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start planning' })).toBeNull();
  });

  it('sends feature.update when the run mode changes', async () => {
    answerProcedure('feature/get', answerJson(featureFixture({ state: 'plan_ready' })));
    const updates = answerProcedure(
      'feature/update',
      answerJson(featureFixture({ state: 'plan_ready', runMode: 'auto_loop' })),
    );
    await renderScreen();

    await userEvent.click(await screen.findByRole('combobox', { name: 'Run mode' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Auto loop' }));

    expect(await screen.findByText('Planning starts by itself under Auto loop.')).toBeTruthy();
    expect(updates).toEqual([{ featureId: FEATURE_ID, runMode: 'auto_loop' }]);
  });

  it('sends contextFile.update with ticked false when a file is unticked', async () => {
    const files = [contextFileSummaryFixture()];
    answerProcedure(
      'feature/get',
      answerJson(featureFixture({ state: 'plan_ready', contextFiles: files })),
      answerJson(
        featureFixture({
          state: 'plan_ready',
          contextFiles: [contextFileSummaryFixture({ ticked: false })],
        }),
      ),
    );
    const updates = answerProcedure(
      'contextFile/update',
      answerJson(contextFileFixture({ ticked: false })),
    );
    await renderScreen();
    const tick = await screen.findByRole('checkbox', { name: 'Feature brief' });

    await userEvent.click(tick);

    await waitFor(() => expect(tick.getAttribute('aria-checked')).toBe('false'));
    expect(updates).toEqual([{ contextFileId: CONTEXT_FILE_ID, ticked: false }]);
  });
});

describe('FeatureScreen states', () => {
  it('shows a skeleton while the feature loads', async () => {
    answerProcedure('feature/get', neverAnswers);

    await renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading feature' })).toBeTruthy();
  });

  it('shows Feature not found for NOT_FOUND', async () => {
    answerProcedure('feature/get', rpcError('NOT_FOUND', 404));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Feature not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to features' }).getAttribute('href')).toBe(
      '/features',
    );
  });

  it('shows the error and Retry when the feature fails to load', async () => {
    answerProcedure(
      'feature/get',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(featureFixture({ state: 'plan_ready' })),
    );
    await renderScreen();

    expect(await screen.findByText('The feature could not be loaded')).toBeTruthy();
    expect(screen.getByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Export invoices as CSV' })).toBeTruthy();
  });

  it('keeps the feature on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'feature/get',
      answerJson(featureFixture({ state: 'plan_ready' })),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderScreen();
    await screen.findByRole('heading', { name: 'Export invoices as CSV' });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Export invoices as CSV' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View run' }).getAttribute('href')).toBe(
      `/runs/${RUN_ID}`,
    );
  });
});
