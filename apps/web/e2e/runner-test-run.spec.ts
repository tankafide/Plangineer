import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { revokeRunner, type RunningRunner, startRunner } from './fake-runner.ts';
import { SESSION_STATE } from './session-state.ts';

test.use({ storageState: SESSION_STATE });

async function startRun(page: Page, runnerName: string, prompt: string): Promise<void> {
  await page.goto('/runs');
  await page.getByRole('combobox', { name: 'Runner' }).click();
  await page.getByRole('option', { name: runnerName }).click();
  await page.getByLabel('Repository').fill('acme/app');
  await page.getByLabel('Ref').fill('main');
  await page.getByLabel('Prompt').fill(prompt);
  await page.getByRole('button', { name: 'Start run' }).click();
  await expect(page).toHaveURL(/\/runs\/[0-9a-f-]{36}$/);
}

test.describe('a test run on a paired runner', () => {
  let root: string;
  let runnerName: string;
  let runner: RunningRunner;

  test.beforeEach(async ({ page, baseURL }, testInfo) => {
    if (baseURL === undefined) throw new Error('The Playwright config has no baseURL');
    root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-e2e-'));
    runnerName = `e2e-${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
    runner = await startRunner(page, baseURL, root, runnerName);
  });

  test.afterEach(async ({ page }) => {
    await runner.stop();
    await revokeRunner(page, runnerName);
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  test('streams its events until Succeeded', async ({ page }) => {
    await startRun(page, runnerName, 'List the files in this folder and name one.');

    await expect(page.getByRole('list', { name: 'Run events' })).toContainText('Glob');
    await expect(page.getByText('Succeeded').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel run' })).toHaveCount(0);
  });

  test('cancels a hanging run', async ({ page }) => {
    await startRun(page, runnerName, 'fake:hang');
    await expect(page.getByText('Running').first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancel run' }).click();
    await page.getByRole('button', { name: 'Cancel run' }).click();

    await expect(page.getByText('Cancelled').first()).toBeVisible();
  });
});
