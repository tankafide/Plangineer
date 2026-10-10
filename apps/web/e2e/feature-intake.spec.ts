import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { revokeRunner, type RunningRunner, startRunner } from './fake-runner.ts';
import { SESSION_STATE } from './session-state.ts';

test.use({ storageState: SESSION_STATE });

const TOPIC = 'PDF rendering in Node';

test.describe('feature intake on a paired runner', () => {
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

  test('takes a feature to Plan ready and starts planning', async ({ page }) => {
    await page.goto('/');
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Features' })
      .click();
    await page.getByRole('main').getByRole('link', { name: 'New feature' }).first().click();

    await page.getByRole('combobox', { name: 'Repository' }).click();
    await page.getByRole('option', { name: 'acme/app' }).click();
    await page
      .getByRole('textbox', { name: 'Description' })
      .fill(
        `Export a plan as PDF ${randomUUID().slice(0, 8)}\n\nEngineers share plans with people outside the app.`,
      );
    await page
      .getByRole('textbox', { name: 'Ticket link' })
      .fill('https://tracker.example.com/APP-12');
    await expect(page.getByRole('checkbox', { name: 'Explore the codebase' })).toBeChecked();
    await page.getByRole('textbox', { name: 'Research topics' }).fill(TOPIC);
    await expect(page.getByRole('combobox', { name: 'Run mode' })).toHaveText(/Manual/);
    await page.getByRole('button', { name: 'Start feature' }).click();

    await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}$/);
    const header = page.getByRole('heading', { level: 1 }).locator('..');
    await expect(header).toContainText('Plan ready', { timeout: 60_000 });
    const tasks = page.getByRole('list', { name: 'Tasks' }).getByRole('listitem');
    await expect(tasks).toHaveCount(3);
    await expect(tasks.filter({ hasText: 'Succeeded' })).toHaveCount(3);
    const files = page.getByRole('list', { name: 'Context files' });
    await expect(files.getByRole('checkbox')).toHaveCount(3);

    const research = files.getByRole('checkbox', { name: `Research: ${TOPIC}` });
    await research.click();
    await expect(research).not.toBeChecked();

    await files.getByRole('link', { name: 'Open Feature brief' }).click();
    const title = page.getByRole('textbox', { name: 'Title' });
    await title.fill('Brief for PDF export');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.')).toBeVisible();
    await page.getByRole('link', { name: 'Back' }).click();

    await expect(files.getByRole('checkbox', { name: 'Brief for PDF export' })).toBeVisible();
    await page.getByRole('button', { name: 'Start planning' }).click();
    await expect(header).toContainText('Planning');
  });
});
