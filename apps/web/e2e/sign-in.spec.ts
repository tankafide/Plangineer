import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { E2E_APP_STATE } from './session-state.ts';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize**';
const { clientId } = z
  .object({ clientId: z.string() })
  .parse(JSON.parse(readFileSync(E2E_APP_STATE, 'utf8')));

test('a signed-out visit lands on sign-in, and the button starts GitHub sign-in', async ({
  page,
}) => {
  // Abort the hand-off to GitHub, so the journey never calls the real service.
  await page.route(GITHUB_AUTHORIZE, (route) => route.abort());
  const authorizeRequest = page.waitForRequest(GITHUB_AUTHORIZE);

  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in\?redirect=%2F$/);
  const button = page.getByRole('button', { name: 'Sign in with GitHub' });
  await expect(button).toBeVisible();

  await button.click();

  const authorizeUrl = new URL((await authorizeRequest).url());
  expect(authorizeUrl.searchParams.get('client_id')).toBe(clientId);
});
