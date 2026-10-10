import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { revokeRunner, type RunningRunner, startRunner } from './fake-runner.ts';
import { SESSION_STATE } from './session-state.ts';

test.use({ storageState: SESSION_STATE });

// Each planning turn is one fake agent run on the runner.
const TURN_TIMEOUT = 60_000;
const EDITED_TITLE = 'Render the export as PDF';

/** Waits until the plan shows the revision, which means the turn or save that made it is done. */
async function expectRevision(page: Page, number: number): Promise<void> {
  await expect(page.getByText(`Revision ${number}`, { exact: true })).toBeVisible({
    timeout: TURN_TIMEOUT,
  });
}

test.describe('planning on a paired runner', () => {
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

  test('takes a feature from context files to Ready for review', async ({ page }) => {
    await page.goto('/features/new');
    await page.getByRole('combobox', { name: 'Repository' }).click();
    await page.getByRole('option', { name: 'acme/app' }).click();
    await page
      .getByRole('textbox', { name: 'Description' })
      .fill(
        `Export a plan ${randomUUID().slice(0, 8)}\n\nEngineers share plans with people outside the app.`,
      );
    await expect(page.getByRole('combobox', { name: 'Run mode' })).toHaveText(/Manual/);
    await page.getByRole('button', { name: 'Start feature' }).click();

    await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}$/);
    const featureHeader = page.getByRole('heading', { level: 1 }).locator('..');
    await expect(featureHeader).toContainText('Plan ready', { timeout: TURN_TIMEOUT });
    await page.getByRole('button', { name: 'Start planning' }).click();
    await expect(page).toHaveURL(/\/features\/[0-9a-f-]{36}\/plan$/);

    // The guided turn asks one question, and the recommended choice comes first.
    const choices = page.getByRole('list', { name: 'Choices' });
    await expect(choices).toBeVisible({ timeout: TURN_TIMEOUT });
    await choices.getByRole('button').first().click();
    await expectRevision(page, 1);

    // Editing step 1 marks its test row stale, and Mark checked clears it.
    const stepOne = page.getByRole('listitem', { name: '1. Render the export' });
    await stepOne.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill(EDITED_TITLE);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expectRevision(page, 2);
    await expect(page.getByRole('heading', { name: `1. ${EDITED_TITLE}` })).toBeVisible();

    const testPlan = page.locator('#section-test_plan');
    // The grid renders a table and a phone list, and CSS hides the one that does not fit.
    const staleMarker = testPlan.getByText('Stale', { exact: true }).filter({ visible: true });
    await expect(staleMarker).toBeVisible();
    await testPlan.getByRole('button', { name: 'Mark checked' }).click();
    await testPlan.getByRole('button', { name: 'Save coverage' }).click();
    await expectRevision(page, 3);
    await expect(staleMarker).toHaveCount(0);

    await page.getByRole('button', { name: 'Expand Goal' }).click();
    await expectRevision(page, 4);
    await expect(page.locator('#section-goal')).toContainText('(expanded)');

    const planHeader = page.getByRole('heading', { level: 1 }).locator('..');
    await page.getByRole('button', { name: 'Mark ready' }).click();
    await expect(planHeader).toContainText('Ready for review');

    // The history opens on the two newest revisions, and revision 1 shows the old title.
    await page.getByRole('link', { name: 'Revision history' }).click();
    await page.getByRole('combobox', { name: 'From' }).click();
    await page.getByRole('option', { name: /^Revision 1 ·/ }).click();
    await expect(page).toHaveURL(/from=1/);
    await expect(page).toHaveURL(/to=4/);
    await expect(page.getByText(EDITED_TITLE).first()).toBeVisible();
    await expect(page.getByText('(expanded)').first()).toBeVisible();
  });
});
