import { randomUUID } from 'node:crypto';
import { call } from '@orpc/server';
import { PlanBody } from '@plangineer/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { router } from '../rpc/router.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planScenarios } from '../test/plan-scenarios.ts';
import { finishTurn, latestTurn, planDraft, revisionsOf, storeTurn } from '../test/planning.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('plan write procedures', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let scenario: ReturnType<typeof planScenarios>;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    const admin = await storeUser(testAuth(database.db), { role: 'admin' });
    scenario = planScenarios(deps, await storeRepository(database.db, { createdBy: admin.id }));
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A member's planning feature with revision 1. */
  async function drafted() {
    const member = await scenario.member();
    const featureId = await scenario.feature(member.userId);
    const body = await scenario.revision(featureId, member.userId);
    return { ...member, featureId, body };
  }

  describe('plan.edit', () => {
    it('stores the next revision with the engineer as author and stale rows for the edited step', async () => {
      const { userId, context, featureId, body } = await drafted();
      const [first, second] = body.steps;
      if (first === undefined || second === undefined) throw new Error('Two steps');

      const workspace = await call(
        router.plan.edit,
        {
          featureId,
          revision: 1,
          body: { ...body, steps: [{ ...first, title: 'Render it' }, second] },
        },
        { context },
      );

      const [, stored] = await revisionsOf(database.db, featureId);
      const edited = new Set(first.doneWhen.map((line) => line.id));
      expect(workspace.revision).toMatchObject({ number: 2, source: 'engineer' });
      expect(stored).toMatchObject({
        number: 2,
        source: 'engineer',
        authorId: userId,
        turnId: null,
      });
      expect(PlanBody.parse(stored?.body).coverage.map((row) => row.stale)).toEqual(
        body.coverage.map((row) => edited.has(row.lineId)),
      );
    });

    it('answers INPUT_VALIDATION_FAILED for a step naming another repository', async () => {
      const { context, featureId, body } = await drafted();
      const steps = body.steps.map((step) => ({ ...step, repositoryId: randomUUID() }));

      await expect(
        call(router.plan.edit, { featureId, revision: 1, body: { ...body, steps } }, { context }),
      ).rejects.toMatchObject({ code: 'INPUT_VALIDATION_FAILED' });
      expect(await revisionsOf(database.db, featureId)).toHaveLength(1);
    });
  });

  describe('plan.sectionAction, plan.reviseStep, plan.retry and plan.continue', () => {
    it('queues a section action turn with its section and action', async () => {
      const { context, featureId } = await drafted();

      await call(
        router.plan.sectionAction,
        { featureId, revision: 1, section: 'goal', action: 'expand' },
        { context },
      );

      expect(await latestTurn(database.db, featureId)).toMatchObject({
        kind: 'section_action',
        section: 'goal',
        action: 'expand',
        job: { turn: 'section_action', section: 'goal' },
      });
    });

    it('queues a step revision with the step and the instruction', async () => {
      const { context, featureId, body } = await drafted();
      const stepId = body.steps[0]?.id ?? '';

      await call(
        router.plan.reviseStep,
        { featureId, revision: 1, stepId, instruction: 'Split it in two.' },
        { context },
      );

      expect(await latestTurn(database.db, featureId)).toMatchObject({
        kind: 'revise_step',
        stepId,
        instruction: 'Split it in two.',
      });
    });

    it('repeats a failed section action, and answers nothing_to_retry after a success', async () => {
      const { userId, runnerId, context, featureId } = await drafted();
      const spec = { kind: 'section_action', section: 'verification', action: 'simplify' } as const;
      const failed = await scenario.failedTurn(featureId, userId, runnerId, spec);

      await call(router.plan.retry, { featureId }, { context });
      const retried = await latestTurn(database.db, featureId);
      await finishTurn(deps, runnerId, retried.runId, {
        kind: 'section',
        patch: {
          section: 'verification',
          verification: { automated: ['pnpm verify'], agentChecks: [], humanChecks: [] },
        },
      });

      expect(retried).toMatchObject({
        kind: 'section_action',
        section: 'verification',
        action: 'simplify',
      });
      expect(retried.runId).not.toBe(failed);
      await expect(call(router.plan.retry, { featureId }, { context })).rejects.toMatchObject({
        code: 'CONFLICT',
        data: { reason: 'nothing_to_retry' },
      });
    });

    it('answers questions_open to plan.continue while a question is open', async () => {
      const { userId, runnerId, context, featureId } = await drafted();
      await scenario.askedQuestions(featureId, userId, runnerId);

      await expect(call(router.plan.continue, { featureId }, { context })).rejects.toMatchObject({
        code: 'CONFLICT',
        data: { reason: 'questions_open' },
      });
    });
  });

  describe('plan.markReady', () => {
    it('moves a ready plan to ready_for_review, and a later edit moves it back to planning', async () => {
      const { context, featureId, body } = await drafted();

      const ready = await call(router.plan.markReady, { featureId, revision: 1 }, { context });
      const edited = await call(
        router.plan.edit,
        { featureId, revision: 1, body: { ...body, goal: 'Export plans as PDF.' } },
        { context },
      );

      expect(ready.featureState).toBe('ready_for_review');
      expect(edited.featureState).toBe('planning');
    });

    it('answers not_ready for a plan with a stale row', async () => {
      const { userId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      await scenario.revision(featureId, userId, 1, scenario.staleBody());

      await expect(
        call(router.plan.markReady, { featureId, revision: 1 }, { context }),
      ).rejects.toMatchObject({ code: 'CONFLICT', data: { reason: 'not_ready' } });
    });
  });

  it('reports autoLoopStopped after three unready Auto loop drafts', async () => {
    const { userId, runnerId, context } = await scenario.member();
    const featureId = await scenario.feature(userId, { runMode: 'auto_loop' });
    const unready = planDraft({
      steps: [
        {
          id: 'new-1',
          title: 'Render',
          files: [],
          body: '',
          doneWhen: [{ id: 'new-2', text: 'Renders.' }],
        },
      ],
    });
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId, runMode: 'auto_loop' });
    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: unready });
    const redraft = async () => {
      const turn = await latestTurn(database.db, featureId);
      await finishTurn(deps, runnerId, turn.runId, { kind: 'plan', plan: unready });
    };
    await redraft();
    await redraft();

    const workspace = await call(router.plan.get, { featureId }, { context });

    expect(workspace).toMatchObject({ revision: { number: 3 }, autoLoopStopped: true });
  });
});
