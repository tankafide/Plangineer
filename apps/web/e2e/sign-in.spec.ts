import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { expect, test } from '@playwright/test';

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize**';
const { GITHUB_APP_CLIENT_ID } = parseEnv(
  readFileSync(fileURLToPath(new URL('../../../.env', import.meta.url)), 'utf8'),
);

test('a signed-out visit lands on sign-in, and the button starts GitHub sign-in', async ({
  page,
}) => {
  // Abort the hand-off to GitHub, so the journey never calls the real service.
  await page.route(GITHUB_AUTHORIZE, (route) => route.abort());
  const authorizeRequest = page.waitForRequest(GITHUB_AUTHORIZE);

  await page.goto('/');

  await expect(page).toHaveURL(/\/sign-in$/);
  const button = page.getByRole('button', { name: 'Sign in with GitHub' });
  await expect(button).toBeVisible();

  await button.click();

  const authorizeUrl = new URL((await authorizeRequest).url());
  expect(authorizeUrl.searchParams.get('client_id')).toBe(GITHUB_APP_CLIENT_ID);
});
