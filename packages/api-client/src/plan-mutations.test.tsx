import { PlanEditInput, type PlanBody, type PlanWorkspace } from '@plangineer/contracts';
import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { useFeature } from './features.ts';
import {
  useAnswerQuestion,
  useContinuePlanning,
  useEditPlan,
  useMarkReady,
  usePlan,
  useRetryTurn,
  useReviseStep,
  useSectionAction,
} from './plan.ts';
import {
  FEATURE_ID,
  featureFixture,
  planBodyFixture,
  planRevisionFixture,
  planWorkspaceFixture,
  STEP_IDS,
} from './test-fixtures.ts';
import {
  answerProcedure,
  renderHooks,
  RPC_URL,
  rpcBody,
  rpcConflict,
  rpcInput,
  server,
} from './test-utils.tsx';

const QUESTION_ID = '0199c1a9-7777-7d4e-8f90-000000000300';

/** Renders a mutation hook beside a loaded workspace and feature, so the cache holds both. */
async function renderLoaded<T>(useMutationHook: () => T, workspace = planWorkspaceFixture()) {
  answerProcedure('plan/get', workspace);
  const features = answerProcedure('feature/get', featureFixture({ state: 'planning' }));
  const view = renderHooks(() => ({
    mutation: useMutationHook(),
    plan: usePlan(FEATURE_ID),
    feature: useFeature(FEATURE_ID),
  }));
  await waitFor(() => expect(view.result.current.hooks.plan.isSuccess).toBe(true));
  await waitFor(() => expect(view.result.current.hooks.feature.isSuccess).toBe(true));
  return { ...view, features };
}

const RETURNED = planWorkspaceFixture({
  featureState: 'ready_for_review',
  revision: planRevisionFixture({ number: 2 }),
});

/** A hook's send function bound to one input, so the table can hold hooks of different inputs. */
function sendWith<I>(mutation: { mutateAsync: (input: I) => Promise<PlanWorkspace> }, input: I) {
  return () => mutation.mutateAsync(input);
}

const ANSWER = { questionId: QUESTION_ID, choice: 0 };
const FEATURE = { featureId: FEATURE_ID };
const SECTION_ACTION = {
  featureId: FEATURE_ID,
  revision: 1,
  section: 'goal',
  action: 'expand',
} as const;
const REVISE_STEP = {
  featureId: FEATURE_ID,
  revision: 1,
  stepId: STEP_IDS[0],
  instruction: 'Split it.',
};
const MARK_READY = { featureId: FEATURE_ID, revision: 1 };

describe('plan mutations', () => {
  it.each([
    ['plan/answer', ANSWER, () => sendWith(useAnswerQuestion(), ANSWER)],
    ['plan/continue', FEATURE, () => sendWith(useContinuePlanning(), FEATURE)],
    ['plan/retry', FEATURE, () => sendWith(useRetryTurn(), FEATURE)],
    ['plan/sectionAction', SECTION_ACTION, () => sendWith(useSectionAction(), SECTION_ACTION)],
    ['plan/reviseStep', REVISE_STEP, () => sendWith(useReviseStep(), REVISE_STEP)],
    ['plan/markReady', MARK_READY, () => sendWith(useMarkReady(), MARK_READY)],
  ])(
    '%s writes the returned workspace into plan.get and refetches the feature',
    async (path, input, useSend) => {
      const sent = answerProcedure(path, RETURNED);
      const { result, features } = await renderLoaded(useSend);

      await act(() => result.current.hooks.mutation());

      expect(sent).toEqual([input]);
      expect(result.current.hooks.plan.data).toEqual(RETURNED);
      expect(features).toHaveLength(2);
    },
  );
});

/** The body with its steps in reverse order. */
const reordered = (body: PlanBody = planBodyFixture()) => ({
  ...body,
  steps: body.steps.toReversed(),
});

describe('useEditPlan', () => {
  it('shows the edited body at once and puts the previous body back when the save fails', async () => {
    const saved = Promise.withResolvers<void>();
    server.use(
      http.post(`${RPC_URL}/plan/edit`, async () => {
        await saved.promise;
        return rpcConflict('stale_revision');
      }),
    );
    const { result } = await renderLoaded(() => useEditPlan(FEATURE_ID));
    const titles = () => result.current.hooks.plan.data?.revision?.body.steps.map((s) => s.title);

    act(() => result.current.hooks.mutation.mutate({ body: reordered() }));

    await waitFor(() => expect(titles()).toEqual(['Step 2', 'Step 1']));
    saved.resolve();
    await waitFor(() => expect(result.current.hooks.mutation.isError).toBe(true));
    expect(titles()).toEqual(['Step 1', 'Step 2']);
  });

  it('sends consecutive revision numbers for two quick edits and keeps the second on screen', async () => {
    const firstSaved = Promise.withResolvers<void>();
    const inputs: unknown[] = [];
    const first = reordered();
    const second = {
      ...first,
      steps: first.steps.map((step, index) => (index === 0 ? { ...step, title: 'Renamed' } : step)),
    };
    server.use(
      http.post(`${RPC_URL}/plan/edit`, async ({ request }) => {
        const input = PlanEditInput.parse(await rpcInput(request));
        inputs.push(input);
        if (input.revision === 1) await firstSaved.promise;
        const revision = planRevisionFixture({ number: input.revision + 1, body: input.body });
        return HttpResponse.json(rpcBody(planWorkspaceFixture({ revision })));
      }),
    );
    const { result } = await renderLoaded(() => useEditPlan(FEATURE_ID));
    answerProcedure(
      'plan/get',
      planWorkspaceFixture({ revision: planRevisionFixture({ number: 3, body: second }) }),
    );
    const titles = () => result.current.hooks.plan.data?.revision?.body.steps.map((s) => s.title);

    act(() => result.current.hooks.mutation.mutate({ body: first }));
    act(() => result.current.hooks.mutation.mutate({ body: second }));
    await waitFor(() => expect(inputs).toHaveLength(1));
    expect(titles()).toEqual(['Renamed', 'Step 1']);

    firstSaved.resolve();

    await waitFor(() => expect(inputs).toHaveLength(2));
    expect(titles()).toEqual(['Renamed', 'Step 1']);
    await waitFor(() => expect(result.current.hooks.mutation.isSuccess).toBe(true));
    expect(inputs).toEqual([
      { featureId: FEATURE_ID, revision: 1, body: first },
      { featureId: FEATURE_ID, revision: 2, body: second },
    ]);
    expect(result.current.hooks.plan.data?.revision?.number).toBe(3);
    expect(titles()).toEqual(['Renamed', 'Step 1']);
  });
});
