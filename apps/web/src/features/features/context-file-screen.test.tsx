import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderPage, renderRoute } from '@/test/app-harness';
import {
  CONTEXT_FILE_ID,
  contextFileFixture,
  contextFileSummaryFixture,
  FEATURE_ID,
  featureFixture,
} from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  answerSignedIn,
  neverAnswers,
  page,
  rpcError,
} from '@/test/fixtures';
import { ContextFileScreen } from './context-file-screen';

function renderScreen() {
  return renderPage(() => (
    <ContextFileScreen featureId={FEATURE_ID} contextFileId={CONTEXT_FILE_ID} />
  ));
}

function planReadyWith(title: string) {
  return featureFixture({
    state: 'plan_ready',
    contextFiles: [contextFileSummaryFixture({ title })],
  });
}

describe('ContextFileScreen', () => {
  it('saves a new title and content, and the feature screen shows the new title', async () => {
    answerSignedIn();
    answerProcedure('feature/list', answerJson(page([])));
    answerProcedure(
      'feature/get',
      answerJson(planReadyWith('Feature brief')),
      answerJson(planReadyWith('Brief')),
    );
    answerProcedure('contextFile/get', answerJson(contextFileFixture()));
    const updates = answerProcedure(
      'contextFile/update',
      answerJson(contextFileFixture({ title: 'Brief', content: '# Feature brief\nMore.' })),
    );
    await renderRoute(`/features/${FEATURE_ID}`);
    await userEvent.click(await screen.findByRole('link', { name: 'Open Feature brief' }));

    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Brief');
    const content = screen.getByRole('textbox', { name: 'Content' });
    await userEvent.click(content);
    await userEvent.keyboard('{Control>}{End}{/Control}{Enter}');
    await userEvent.paste('More.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updates).toEqual([
        { contextFileId: CONTEXT_FILE_ID, title: 'Brief', content: '# Feature brief\nMore.' },
      ]),
    );
    expect(await screen.findByText('Saved.')).toBeTruthy();
    await userEvent.click(screen.getByRole('link', { name: 'Back' }));
    const files = within(await screen.findByRole('list', { name: 'Context files' }));
    expect(await files.findByRole('checkbox', { name: 'Brief' })).toBeTruthy();
  });

  it('deletes the file on Delete file and returns to the feature', async () => {
    answerSignedIn();
    answerProcedure('feature/list', answerJson(page([])));
    answerProcedure('contextFile/get', answerJson(contextFileFixture()));
    const deletes = answerProcedure('contextFile/delete', answerJson({ id: CONTEXT_FILE_ID }));
    answerProcedure('feature/get', answerJson(featureFixture({ state: 'plan_ready' })));
    const { router } = await renderRoute(`/features/${FEATURE_ID}/files/${CONTEXT_FILE_ID}`);

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete file' }));

    expect(await screen.findByText('Context files appear here as tasks finish.')).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/features/${FEATURE_ID}`);
    expect(deletes).toEqual([{ contextFileId: CONTEXT_FILE_ID }]);
  });

  it('closes the decision card on Keep without deleting', async () => {
    answerProcedure('contextFile/get', answerJson(contextFileFixture()));
    const deletes = answerProcedure('contextFile/delete', answerJson({ id: CONTEXT_FILE_ID }));
    await renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));

    expect(screen.queryByRole('button', { name: 'Delete file' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(deletes).toEqual([]);
  });

  it('blocks an empty title next to its field', async () => {
    answerProcedure('contextFile/get', answerJson(contextFileFixture()));
    const updates = answerProcedure('contextFile/update', answerJson(contextFileFixture()));
    await renderScreen();

    await userEvent.clear(await screen.findByLabelText('Title'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a title.')).toBeTruthy();
    expect(updates).toEqual([]);
  });
});

describe('ContextFileScreen states', () => {
  it('shows a skeleton while the file loads', async () => {
    answerProcedure('contextFile/get', neverAnswers);

    await renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading context file' })).toBeTruthy();
  });

  it('shows Context file not found for NOT_FOUND, with a way back to the feature', async () => {
    answerProcedure('contextFile/get', rpcError('NOT_FOUND', 404));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Context file not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the feature' }).getAttribute('href')).toBe(
      `/features/${FEATURE_ID}`,
    );
  });

  it('shows the error and Retry when the file fails to load', async () => {
    answerProcedure(
      'contextFile/get',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(contextFileFixture()),
    );
    await renderScreen();

    expect(await screen.findByText('The context file could not be loaded')).toBeTruthy();
    expect(screen.getByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText('Title')).toBeTruthy();
  });

  it('keeps the file on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'contextFile/get',
      answerJson(contextFileFixture()),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderScreen();
    await screen.findByLabelText('Title');

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByDisplayValue('Feature brief')).toBeTruthy();
  });
});
