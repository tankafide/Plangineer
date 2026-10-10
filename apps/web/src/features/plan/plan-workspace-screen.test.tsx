import type { ReadinessItem } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { renderPage, server } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import {
  answerJson,
  answerProcedure,
  EVENTS_URL,
  messageEvent,
  neverAnswers,
  rpcError,
  sseResponse,
} from '@/test/fixtures';
import {
  answerPlanWorkspace,
  planningTurnFixture,
  planWorkspaceFixture,
} from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

const TITLE = 'Export invoices as CSV';

function renderScreen() {
  return renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
}

const READY: ReadinessItem[] = [
  { key: 'open_questions', ok: true, count: 0 },
  { key: 'step_files', ok: true, count: 0 },
  { key: 'done_when', ok: true, count: 0 },
  { key: 'coverage', ok: true, count: 0 },
  { key: 'stale_rows', ok: true, count: 0 },
  { key: 'blockers', ok: true, count: 0 },
];

const RUNNING_TURN = planningTurnFixture({ status: 'running' });

describe('PlanWorkspaceScreen states', () => {
  it('shows the feature title, its state and the revision', async () => {
    answerPlanWorkspace(answerJson(planWorkspaceFixture()));

    await renderScreen();

    const title = await screen.findByRole('heading', { level: 1, name: TITLE });
    expect(title.parentElement?.textContent).toContain('Planning');
    expect(screen.getByText('Revision 1')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Revision history' }).getAttribute('href')).toBe(
      `/features/${FEATURE_ID}/plan/revisions`,
    );
  });

  it('shows a skeleton while the plan loads', async () => {
    answerPlanWorkspace(neverAnswers);

    await renderScreen();

    expect(await screen.findByRole('status', { name: 'Loading plan' })).toBeTruthy();
  });

  it('shows Feature not found for NOT_FOUND', async () => {
    answerPlanWorkspace(rpcError('NOT_FOUND', 404));

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Feature not found' })).toBeTruthy();
  });

  it('links back to a feature that is not planning yet', async () => {
    answerPlanWorkspace(
      answerJson(planWorkspaceFixture({ featureState: 'plan_ready', revision: null, turn: null })),
    );

    await renderScreen();

    expect(await screen.findByRole('heading', { name: 'Planning has not started' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to the feature' }).getAttribute('href')).toBe(
      `/features/${FEATURE_ID}`,
    );
  });

  it('shows the error and Retry when the plan fails to load', async () => {
    answerPlanWorkspace(
      rpcError('INTERNAL_SERVER_ERROR', 500, 'Database down'),
      answerJson(planWorkspaceFixture()),
    );
    await renderScreen();

    expect(await screen.findByText('Database down')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeTruthy();
  });

  it('keeps the plan on screen, marked stale, when a refetch fails', async () => {
    answerPlanWorkspace(answerJson(planWorkspaceFixture()), rpcError('INTERNAL_SERVER_ERROR', 500));
    const { queryClient } = await renderScreen();
    await screen.findByRole('heading', { level: 1, name: TITLE });

    await queryClient.refetchQueries();

    expect(await screen.findByText('These details could not be refreshed.')).toBeTruthy();
    expect(screen.getByText('Revision 1')).toBeTruthy();
  });

  it('lists the decisions so far and waits for the draft before the first revision', async () => {
    answerPlanWorkspace(
      answerJson(
        planWorkspaceFixture({
          revision: null,
          decisions: [
            { id: crypto.randomUUID(), title: 'Use streams', reason: 'Big files.', by: 'agent' },
          ],
        }),
      ),
    );

    await renderScreen();

    const decisions = await screen.findByRole('list', { name: 'Decisions' });
    expect(within(decisions).getByText('Use streams')).toBeTruthy();
    expect(within(decisions).getByText('Agent')).toBeTruthy();
    expect(screen.getByText('The plan appears here once the agent drafts it.')).toBeTruthy();
  });
});

describe('PlanWorkspaceScreen turn status', () => {
  it("shows a running turn with the agent's last message, and disables the actions", async () => {
    answerPlanWorkspace(
      answerJson(
        planWorkspaceFixture({
          turn: RUNNING_TURN,
          sections: [{ section: 'goal', status: 'complete' }],
        }),
      ),
    );
    server.use(
      http.get(EVENTS_URL, () =>
        sseResponse([messageEvent(1, 'Reading the code'), messageEvent(2, 'Drafting step 2')]),
      ),
    );

    await renderScreen();

    expect(await screen.findByText('Agent is working')).toBeTruthy();
    expect(await screen.findByText('Drafting step 2')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View run' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand Goal' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getAllByText('The agent is still working on this plan.').length).toBeGreaterThan(
      0,
    );
  });

  it('shows Retry for a failed turn, which sends plan.retry', async () => {
    answerPlanWorkspace(
      answerJson(planWorkspaceFixture({ turn: planningTurnFixture({ status: 'failed' }) })),
    );
    const retries = answerProcedure('plan/retry', answerJson(planWorkspaceFixture()));
    await renderScreen();

    expect(await screen.findByText("The agent's turn failed")).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await vi.waitFor(() => expect(retries).toEqual([{ featureId: FEATURE_ID }]));
  });
});

describe('PlanWorkspaceScreen readiness', () => {
  it('shows each checklist item and section status from the workspace', async () => {
    answerPlanWorkspace(
      answerJson(
        planWorkspaceFixture({
          readiness: READY.map((item) =>
            item.key === 'stale_rows' ? { ...item, ok: false, count: 2 } : item,
          ),
          sections: [
            { section: 'goal', status: 'complete' },
            { section: 'steps', status: 'open_question' },
            { section: 'test_plan', status: 'needs_work' },
          ],
        }),
      ),
    );

    await renderScreen();

    const checklist = await screen.findByRole('list', { name: 'Readiness' });
    expect(within(checklist).getByText('No step without files')).toBeTruthy();
    expect(within(checklist).getByText('2 stale test rows')).toBeTruthy();
    expect(within(checklist).getAllByRole('listitem')).toHaveLength(6);
    const rail = screen.getByRole('navigation', { name: 'Plan sections' });
    expect(
      within(rail)
        .getByRole('link', { name: /^Goal\s*Complete$/ })
        .getAttribute('href'),
    ).toBe('#section-goal');
    expect(within(rail).getByRole('link', { name: /^Steps\s*Open question$/ })).toBeTruthy();
    expect(within(rail).getByRole('link', { name: /^Test plan\s*Needs work$/ })).toBeTruthy();
    expect(document.getElementById('section-test_plan')).toBeTruthy();
  });

  it('offers Continue planning, not Mark ready, for a plan that is not ready', async () => {
    answerPlanWorkspace(
      answerJson(planWorkspaceFixture({ readiness: [{ key: 'blockers', ok: false, count: 1 }] })),
    );

    await renderScreen();

    expect(await screen.findByRole('button', { name: 'Continue planning' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark ready' })).toBeNull();
  });

  it('sends plan.markReady for a ready plan', async () => {
    answerPlanWorkspace(answerJson(planWorkspaceFixture({ readiness: READY })));
    const marks = answerProcedure(
      'plan/markReady',
      answerJson(planWorkspaceFixture({ readiness: READY, featureState: 'ready_for_review' })),
    );
    await renderScreen();

    await userEvent.click(await screen.findByRole('button', { name: 'Mark ready' }));

    await vi.waitFor(() => expect(marks).toEqual([{ featureId: FEATURE_ID, revision: 1 }]));
    expect(await screen.findByText('Ready for review')).toBeTruthy();
  });

  it('says when the Auto loop stopped after three unready drafts', async () => {
    answerPlanWorkspace(
      answerJson(
        planWorkspaceFixture({
          runMode: 'auto_loop',
          autoLoopStopped: true,
          readiness: [{ key: 'coverage', ok: false, count: 1 }],
        }),
      ),
    );

    await renderScreen();

    expect(
      await screen.findByText('Auto loop stopped after 3 drafts that were not ready.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue planning' })).toBeTruthy();
  });
});
