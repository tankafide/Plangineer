import type { PlanRevision } from '@plangineer/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderPage, renderRoute, RPC_URL, rpcBody, server } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  answerSignedIn,
  neverAnswers,
  page,
  rpcError,
} from '@/test/fixtures';
import { planBodyFixture, planRevisionFixture } from '@/test/plan-fixtures';
import { rpcInput } from '@/test/rpc-input';
import { RevisionHistoryScreen } from './revision-history-screen';

/** Revision n of a plan whose first step is titled `Title n`. */
function revision(number: number, source: PlanRevision['source'] = 'agent'): PlanRevision {
  const body = planBodyFixture();
  return planRevisionFixture({
    number,
    source,
    body: {
      ...body,
      steps: body.steps.map((step, index) =>
        index === 0 ? { ...step, title: `Title ${number}` } : step,
      ),
    },
  });
}

function summary(number: number) {
  const { id, source, createdAt } = revision(number);
  return { id, number, source, createdAt };
}

/** Answers plan.revision with the revision its input names, as the API does. */
function answerRevisions() {
  const asked: number[] = [];
  server.use(
    http.post(`${RPC_URL}/plan/revision`, async ({ request }) => {
      const input = await rpcInput(request);
      const number =
        typeof input === 'object' && input !== null && 'number' in input ? input.number : null;
      if (typeof number !== 'number') throw new Error('plan.revision was asked for no number');
      asked.push(number);
      return HttpResponse.json(rpcBody(revision(number)), { headers: { Connection: 'close' } });
    }),
  );
  return asked;
}

function renderScreen(from?: number, to?: number) {
  return renderPage(() => <RevisionHistoryScreen featureId={FEATURE_ID} from={from} to={to} />);
}

/** The lines the diff shows as removed and as added. */
function changedLines() {
  const cells = screen.getAllByRole('cell');
  return {
    removed: cells.filter((cell) => cell.classList.contains('diff-code-delete')),
    added: cells.filter((cell) => cell.classList.contains('diff-code-insert')),
  };
}

const texts = (cells: HTMLElement[]) => cells.map((cell) => cell.textContent);

describe('RevisionHistoryScreen', () => {
  it('opens on the two newest revisions', async () => {
    answerProcedure('plan/revisions', answerJson(page([summary(3), summary(2), summary(1)])));
    const asked = answerRevisions();

    await renderScreen();

    await screen.findByRole('table');
    expect(screen.getByRole('combobox', { name: 'From' }).textContent).toMatch(
      /^Revision 2 · Agent · /,
    );
    expect(screen.getByRole('combobox', { name: 'To' }).textContent).toMatch(/^Revision 3 · /);
    expect(texts(changedLines().removed)).toEqual(['### 1. Title 2']);
    expect(texts(changedLines().added)).toEqual(['### 1. Title 3']);
    expect(asked.toSorted((a, b) => a - b)).toEqual([2, 3]);
  });

  it('writes picked revisions to the URL and shows their diff', async () => {
    answerSignedIn();
    answerProcedure('feature/list', answerJson(page([])));
    answerProcedure('plan/revisions', answerJson(page([summary(3), summary(2), summary(1)])));
    answerRevisions();
    const { router } = await renderRoute(`/features/${FEATURE_ID}/plan/revisions`);

    await userEvent.click(await screen.findByRole('combobox', { name: 'From' }));
    await userEvent.click(await screen.findByRole('option', { name: /^Revision 1 · / }));
    await userEvent.click(screen.getByRole('combobox', { name: 'To' }));
    await userEvent.click(await screen.findByRole('option', { name: /^Revision 3 · / }));

    expect(router.state.location.search).toEqual({ from: 1, to: 3 });
    await vi.waitFor(() => expect(texts(changedLines().removed)).toEqual(['### 1. Title 1']));
    expect(texts(changedLines().added)).toEqual(['### 1. Title 3']);
  });

  it('says when there is only one revision', async () => {
    answerProcedure('plan/revisions', answerJson(page([summary(1)])));

    await renderScreen();

    expect(await screen.findByText('Only one revision so far.')).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('says when there is no revision yet', async () => {
    answerProcedure('plan/revisions', answerJson(page([])));

    await renderScreen();

    expect(await screen.findByText('No revisions yet')).toBeTruthy();
  });

  it('shows a skeleton while the revisions load', async () => {
    answerProcedure('plan/revisions', neverAnswers);

    await renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading revisions' })).toBeTruthy();
  });

  it('shows the error and Retry when the revisions fail to load', async () => {
    answerProcedure(
      'plan/revisions',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(page([summary(2), summary(1)])),
    );
    answerRevisions();
    await renderScreen();

    expect(await screen.findByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('combobox', { name: 'From' })).toBeTruthy();
  });

  it('shows the error and Retry when a revision fails to load', async () => {
    answerProcedure('plan/revisions', answerJson(page([summary(2), summary(1)])));
    answerProcedure('plan/revision', rpcError('INTERNAL_SERVER_ERROR', 500, 'Revision lost'));

    await renderScreen();

    expect(await screen.findByText('Revision lost')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps the revisions on screen, marked stale, when a refetch fails', async () => {
    answerProcedure(
      'plan/revisions',
      answerJson(page([summary(2), summary(1)])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    answerRevisions();
    const { queryClient } = await renderScreen();
    await screen.findByRole('combobox', { name: 'From' });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'From' })).toBeTruthy();
  });

  it('links back to the plan', async () => {
    answerProcedure('plan/revisions', answerJson(page([summary(1)])));

    await renderScreen();

    expect((await screen.findByRole('link', { name: 'Back' })).getAttribute('href')).toBe(
      `/features/${FEATURE_ID}/plan`,
    );
  });
});
