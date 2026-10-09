import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderRoute, rpcBody } from '@/test/app-harness';
import { answerJson, answerProcedure, neverAnswers } from '@/test/fixtures';
import {
  answerSetup,
  CONFIGURED,
  holdSetupToken,
  isPrimary,
  MANIFEST_STATE,
  MISSING,
  SETUP_TOKEN,
  signedOut,
  SLUG,
  stepCard,
} from '@/test/get-started';

const POST_URL = 'https://github.com/settings/apps/new';
const MANIFEST = '{"name":"plangineer-a1b2c3"}';
const TITLE = 'Create the GitHub App';

const githubFailed = () =>
  HttpResponse.json(
    rpcBody({
      defined: true,
      code: 'GITHUB_FAILED',
      status: 502,
      message: 'GitHub request failed',
      data: { status: 404, message: 'Not Found' },
    }),
    { status: 502, headers: { Connection: 'close' } },
  );

/** No App yet, a token held, and GitHub's redirect about to come back with the stored state. */
function awaitGithubReturn() {
  holdSetupToken();
  sessionStorage.setItem('plangineer.manifestState', MANIFEST_STATE);
  answerSetup({ status: MISSING, session: signedOut });
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('GithubAppStep', () => {
  it('posts the manifest to GitHub with a state it stores', async () => {
    holdSetupToken();
    answerSetup({ status: MISSING, session: signedOut });
    const manifests = answerProcedure(
      'instance/githubAppManifest',
      answerJson({ postUrl: POST_URL, manifest: MANIFEST }),
    );
    const posted: HTMLFormElement[] = [];
    vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (
      this: HTMLFormElement,
    ) {
      posted.push(this);
    });
    await renderRoute('/get-started');
    const step = await stepCard(TITLE);

    await userEvent.click(step.getByRole('button', { name: 'Create GitHub App' }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(manifests).toEqual([{ setupToken: SETUP_TOKEN }]);
    const state = sessionStorage.getItem('plangineer.manifestState');
    expect(state).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const [form] = posted;
    if (form === undefined) throw new Error('No form was posted');
    expect(form.method).toBe('post');
    expect(form.action).toBe(`${POST_URL}?state=${state}`);
    expect(new FormData(form).get('manifest')).toBe(MANIFEST);
    const button = step.getByRole('button', { name: 'Create GitHub App' });
    expect(button.hasAttribute('disabled')).toBe(true);
  });

  it('completes the App once when GitHub returns the stored state, and removes the code', async () => {
    awaitGithubReturn();
    const completions = answerProcedure('instance/completeGithubApp', answerJson(CONFIGURED));

    const { router } = await renderRoute(`/get-started?code=abc123&state=${MANIFEST_STATE}`);

    const step = await stepCard(TITLE);
    expect(await step.findByText(SLUG)).toBeTruthy();
    expect(step.getByText('Done')).toBeTruthy();
    expect(completions).toEqual([{ setupToken: SETUP_TOKEN, code: 'abc123' }]);
    expect(router.state.location.search).toEqual({});
    expect(sessionStorage.getItem('plangineer.manifestState')).toBeNull();
  });

  it('shows the mismatch text and sends nothing when the state is not the stored one', async () => {
    awaitGithubReturn();
    const completions = answerProcedure('instance/completeGithubApp', answerJson(CONFIGURED));

    const { router } = await renderRoute('/get-started?code=abc123&state=forged');

    const step = await stepCard(TITLE);
    expect(
      await step.findByText('This link did not come from this setup. Start again.'),
    ).toBeTruthy();
    expect(step.getByRole('button', { name: 'Create GitHub App' })).toBeTruthy();
    expect(completions).toEqual([]);
    expect(router.state.location.search).toEqual({});
  });

  it('disables the button with a spinner while the completion call runs', async () => {
    awaitGithubReturn();
    answerProcedure('instance/completeGithubApp', neverAnswers);

    await renderRoute(`/get-started?code=abc123&state=${MANIFEST_STATE}`);

    const step = await stepCard(TITLE);
    const button = step.getByRole('button', { name: 'Create GitHub App' });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it("shows GitHub's message and Try again when GitHub refuses the code", async () => {
    awaitGithubReturn();
    answerProcedure('instance/completeGithubApp', githubFailed);

    await renderRoute(`/get-started?code=abc123&state=${MANIFEST_STATE}`);

    const step = await stepCard(TITLE);
    expect((await step.findByRole('alert')).textContent).toBe('Not Found');
    expect(step.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });

  it('asks for the setup link when no token is held, with no button', async () => {
    answerSetup({ status: MISSING, session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(
      step.getByText('Open this page from the link the Plangineer app or server gave you.'),
    ).toBeTruthy();
    expect(step.queryByRole('button')).toBeNull();
  });

  it('offers Create GitHub App as the primary button when a token is held', async () => {
    holdSetupToken();
    answerSetup({ status: MISSING, session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(
      step.getByText('Create the GitHub App on your GitHub account. GitHub asks you to confirm.'),
    ).toBeTruthy();
    expect(isPrimary(step.getByRole('button', { name: 'Create GitHub App' }))).toBe(true);
  });

  it('shows the ready App with an outline link to it on GitHub', async () => {
    answerSetup({ session: signedOut });

    await renderRoute('/get-started');

    const step = await stepCard(TITLE);
    expect(step.getByText('Done')).toBeTruthy();
    expect(step.getByText(SLUG)).toBeTruthy();
    const link = step.getByRole('link', { name: 'Open on GitHub' });
    expect(link.getAttribute('href')).toBe(`https://github.com/apps/${SLUG}`);
    expect(isPrimary(link)).toBe(false);
  });
});
