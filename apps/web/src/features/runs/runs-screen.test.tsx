import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderPage, renderRoute, server } from '@/test/app-harness';
import {
  answerJson,
  answerProcedure,
  answerSignedIn,
  EVENTS_URL,
  neverAnswers,
  page,
  rpcError,
  RUN_ID,
  runFixture,
  RUNNER_ID,
  runnerFixture,
  sseResponse,
} from '@/test/fixtures';
import { RunsScreen } from './runs-screen';

const REVOKED_RUNNER_ID = '0199c1a2-0000-7d4e-8f90-a1b2c3d4e5f6';
const OLDER_RUNNER_ID = '0199c1a2-0000-7d4e-8f90-a1b2c3d4e5f7';

function answerRunners() {
  answerProcedure(
    'runner/list',
    answerJson(
      page([
        runnerFixture(),
        runnerFixture({ id: REVOKED_RUNNER_ID, name: 'old-box', status: 'revoked' }),
      ]),
    ),
  );
}

async function fillForm({ repository, ref }: { repository: string; ref: string }) {
  await userEvent.click(await screen.findByRole('combobox', { name: 'Runner' }));
  await userEvent.click(await screen.findByRole('option', { name: 'ada-laptop' }));
  await userEvent.type(screen.getByLabelText('Repository'), repository);
  await userEvent.type(screen.getByLabelText('Ref'), ref);
  await userEvent.type(screen.getByLabelText('Prompt'), 'List the files.');
}

describe('RunsScreen form', () => {
  it('offers only active runners', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    await renderPage(RunsScreen);

    await userEvent.click(await screen.findByRole('combobox', { name: 'Runner' }));

    expect(await screen.findByRole('option', { name: 'ada-laptop' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'old-box' })).toBeNull();
  });

  it('offers active runners from every page of the runner list', async () => {
    answerProcedure(
      'runner/list',
      answerJson(page([runnerFixture()], OLDER_RUNNER_ID)),
      answerJson(page([runnerFixture({ id: OLDER_RUNNER_ID, name: 'older-box' })])),
    );
    answerProcedure('run/list', answerJson(page([])));
    await renderPage(RunsScreen);

    await userEvent.click(await screen.findByRole('combobox', { name: 'Runner' }));

    expect(await screen.findByRole('option', { name: 'older-box' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'ada-laptop' })).toBeTruthy();
  });

  it('blocks a ref starting with - and an invalid repository with field errors', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    const creates = answerProcedure('run/create', answerJson(runFixture()));
    await renderPage(RunsScreen);
    await fillForm({ repository: 'acme', ref: '-main' });

    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

    const repository = screen.getByLabelText('Repository');
    const ref = screen.getByLabelText('Ref');
    expect(repository.getAttribute('aria-invalid')).toBe('true');
    expect(ref.getAttribute('aria-invalid')).toBe('true');
    expect(
      document.getElementById(repository.getAttribute('aria-describedby') ?? '')?.textContent,
    ).toBe('Enter the repository as owner/name.');
    expect(document.getElementById(ref.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'The ref must not start with - or /.',
    );
    expect(creates).toEqual([]);
  });

  it("checks the repository's owner and name with the contract's rules", async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    await renderPage(RunsScreen);
    await fillForm({ repository: 'acme/..', ref: 'main' });

    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(await screen.findByText('The name must be a GitHub repository name.')).toBeTruthy();
  });

  it('asks for a runner when none is chosen', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    await renderPage(RunsScreen);
    await screen.findByRole('combobox', { name: 'Runner' });

    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(await screen.findByText('Choose a runner.')).toBeTruthy();
    expect(screen.getByText('Enter a prompt.')).toBeTruthy();
  });

  it('starts the run and opens its page on a valid submit', async () => {
    answerSignedIn();
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    const creates = answerProcedure('run/create', answerJson(runFixture({ status: 'queued' })));
    server.use(http.get(EVENTS_URL, () => sseResponse([])));
    const { router } = await renderRoute('/runs');
    await fillForm({ repository: 'acme/app', ref: 'main' });

    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(await screen.findByRole('heading', { name: 'acme/app at main' })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/runs/${RUN_ID}`);
    expect(creates).toEqual([
      {
        runnerId: RUNNER_ID,
        repository: { owner: 'acme', name: 'app' },
        ref: 'main',
        prompt: 'List the files.',
      },
    ]);
  });

  it('puts a revoked runner conflict on the Runner field', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));
    answerProcedure('run/create', rpcError('CONFLICT', 409));
    await renderPage(RunsScreen);
    await fillForm({ repository: 'acme/app', ref: 'main' });

    await userEvent.click(screen.getByRole('button', { name: 'Start run' }));

    expect(await screen.findByText('That runner was revoked. Choose another.')).toBeTruthy();
  });
});

describe('RunsScreen list', () => {
  it('shows a skeleton while the runs load', async () => {
    answerRunners();
    answerProcedure('run/list', neverAnswers);

    await renderPage(RunsScreen);

    expect(await screen.findByRole('status', { name: 'Loading runs' })).toBeTruthy();
  });

  it('shows each run with its repository, ref, status and runner, linking to its page', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([runFixture({ status: 'failed' })])));

    await renderPage(RunsScreen);

    const link = await screen.findByRole('link', { name: /acme\/app at main/ });
    expect(link.getAttribute('href')).toBe(`/runs/${RUN_ID}`);
    expect(link.textContent).toContain('Failed');
    expect(link.textContent).toContain('ada-laptop');
  });

  it('shows No runs yet when there are none', async () => {
    answerRunners();
    answerProcedure('run/list', answerJson(page([])));

    await renderPage(RunsScreen);

    expect(await screen.findByText('No runs yet')).toBeTruthy();
  });

  it('shows the error and Retry when the runs fail to load', async () => {
    answerRunners();
    answerProcedure('run/list', rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'));

    await renderPage(RunsScreen);

    expect(await screen.findByText('Runs could not be loaded')).toBeTruthy();
    expect(screen.getByText('Database down')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('keeps the runs on screen, marked stale, when a refetch fails', async () => {
    answerRunners();
    answerProcedure(
      'run/list',
      answerJson(page([runFixture()])),
      rpcError('INTERNAL_SERVER_ERROR', 500),
    );
    const { queryClient } = await renderPage(RunsScreen);
    await screen.findByRole('link', { name: /acme\/app at main/ });

    await queryClient.refetchQueries();

    expect(await screen.findByText('Stale')).toBeTruthy();
    expect(screen.getByRole('link', { name: /acme\/app at main/ })).toBeTruthy();
  });
});
