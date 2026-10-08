import type { RunEvent } from '@plangineer/contracts';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderPage, server } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  COMMIT,
  EVENTS_URL,
  neverAnswers,
  rpcError,
  RUN_ID,
  runEvent,
  runFixture,
  sseResponse,
} from '@/test/fixtures';
import { RunScreen } from './run-screen';

function renderRunScreen() {
  return renderPage(() => <RunScreen runId={RUN_ID} />);
}

function answerStream(events: readonly RunEvent[]) {
  server.use(http.get(EVENTS_URL, () => sseResponse(events)));
}

describe('RunScreen', () => {
  it('shows a skeleton while the run loads', async () => {
    answerProcedure('run/get', neverAnswers);
    answerStream([]);

    await renderRunScreen();

    expect(await screen.findByRole('status', { name: 'Loading run' })).toBeTruthy();
  });

  it('shows Run not found for NOT_FOUND', async () => {
    answerProcedure('run/get', rpcError('NOT_FOUND', 404));
    server.use(http.get(EVENTS_URL, () => new HttpResponse(null, { status: 404 })));

    await renderRunScreen();

    expect(await screen.findByRole('heading', { name: 'Run not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to runs' })).toBeTruthy();
  });

  it('shows the error and Retry when the run fails to load, and recovers', async () => {
    answerProcedure(
      'run/get',
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(runFixture()),
    );
    answerStream([]);
    await renderRunScreen();

    expect(await screen.findByText('The run could not be loaded')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'acme/app at main' })).toBeTruthy();
  });

  it('keeps the run on screen, marked stale, when a refetch fails', async () => {
    answerProcedure('run/get', answerJson(runFixture()), rpcError('INTERNAL_SERVER_ERROR', 500));
    answerStream([]);
    const { queryClient } = await renderRunScreen();
    await screen.findByRole('heading', { name: 'acme/app at main' });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'acme/app at main' })).toBeTruthy();
  });

  it('marks the events stale while the stream reconnects', async () => {
    answerProcedure('run/get', answerJson(runFixture()));
    server.use(http.get(EVENTS_URL, () => new HttpResponse(null, { status: 503 })));

    await renderRunScreen();

    expect(await screen.findByText('Stale')).toBeTruthy();
  });

  it('shows the details, the commit and No events yet before any event', async () => {
    answerProcedure('run/get', answerJson(runFixture()));
    answerStream([]);

    await renderRunScreen();

    expect(await screen.findByText('No events yet')).toBeTruthy();
    expect(screen.getByText(COMMIT.slice(0, 12))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy commit' })).toBeTruthy();
    expect(screen.getByText('List the files in this folder and name one.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Event stream' }).textContent).toBe('Live'),
    );
  });

  it('shows the result of a succeeded run and no Cancel run', async () => {
    answerProcedure('run/get', answerJson(runFixture({ status: 'succeeded' })));
    answerStream([
      runEvent(1, {
        type: 'run.succeeded',
        resultText: 'There are 3 files.',
        truncated: false,
        costUsd: 0.0123,
        durationMs: 9000,
        numTurns: 2,
      }),
    ]);

    await renderRunScreen();

    const result = await screen.findByRole('heading', { name: 'Result' });
    expect(result).toBeTruthy();
    expect(screen.getByText('There are 3 files.')).toBeTruthy();
    expect(screen.getByText('9 s')).toBeTruthy();
    expect((await screen.findByRole('status', { name: 'Event stream' })).textContent).toBe('Ended');
    expect(screen.queryByRole('button', { name: 'Cancel run' })).toBeNull();
  });

  it('shows the reason, message, exit code and error output of a failed run', async () => {
    answerProcedure('run/get', answerJson(runFixture({ status: 'failed' })));
    answerStream([
      runEvent(1, {
        type: 'run.failed',
        reason: 'exit_code',
        message: 'Claude Code exited with code 2.',
        exitCode: 2,
        stderrTail: ['first line', 'last line'],
      }),
    ]);

    await renderRunScreen();

    expect(await screen.findByRole('heading', { name: 'Failure' })).toBeTruthy();
    expect(screen.getAllByText(/The agent exited without a result/)).not.toHaveLength(0);
    expect(screen.getByText('Claude Code exited with code 2.')).toBeTruthy();
    expect(screen.getByText('Exit code')).toBeTruthy();
    expect(screen.getByLabelText('Error output').textContent).toBe('first line\nlast line');
  });

  it('says a queued run waits for its offline runner', async () => {
    answerProcedure(
      'run/get',
      answerJson(
        runFixture({
          status: 'queued',
          startedAt: null,
          commit: null,
          runner: { ...runFixture().runner, online: false },
        }),
      ),
    );
    answerStream([]);

    await renderRunScreen();

    expect(
      await screen.findByText(/Waiting for ada-laptop\. It has been offline since .+\./),
    ).toBeTruthy();
  });

  it('says a queued run waits for its runner plan limit to reset', async () => {
    answerProcedure(
      'run/get',
      answerJson(
        runFixture({
          status: 'queued',
          startedAt: null,
          commit: null,
          runner: { ...runFixture().runner, planLimitResetsAt: '2026-10-07T15:00:00.000Z' },
        }),
      ),
    );
    answerStream([]);

    await renderRunScreen();

    expect(
      await screen.findByText(/ada-laptop reached its Claude plan limit\. Runs resume after .+\./),
    ).toBeTruthy();
  });

  it('cancels only after Cancel run is confirmed', async () => {
    answerProcedure('run/get', answerJson(runFixture()));
    const cancels = answerProcedure(
      'run/cancel',
      answerJson(runFixture({ cancelRequested: true })),
    );
    answerStream([]);
    await renderRunScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep running' }));
    expect(cancels).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));

    expect(
      await screen.findByText('Cancel requested. Waiting for the runner to stop.'),
    ).toBeTruthy();
    expect(cancels).toEqual([{ runId: RUN_ID }]);
  });

  it('says the run already ended when the cancel conflicts', async () => {
    answerProcedure('run/get', answerJson(runFixture()));
    answerProcedure('run/cancel', rpcError('CONFLICT', 409));
    answerStream([]);
    await renderRunScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Cancel run' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel run' }));

    expect(await screen.findByText('This run has already ended.')).toBeTruthy();
  });
});
