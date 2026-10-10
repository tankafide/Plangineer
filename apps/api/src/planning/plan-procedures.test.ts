import { call } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planScenarios } from '../test/plan-scenarios.ts';
import { finishTurn, latestTurn, planDraft } from '../test/planning.ts';
import { runRow } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const get = (featureId: string, context: InitialContext) =>
  call(router.plan.get, { featureId }, { context });

describe('plan procedures', () => {
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

  describe('plan.get', () => {
    it("returns the open questions with the questions turn's decisions, then the draft with its readiness and sections", async () => {
      const { userId, runnerId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      const { questionIds } = await scenario.askedQuestions(featureId, userId, runnerId);

      const asked = await get(featureId, context);
      for (const questionId of questionIds) {
        await call(router.plan.answer, { questionId, choice: 0 }, { context });
      }
      const next = await latestTurn(database.db, featureId);
      await finishTurn(deps, runnerId, next.runId, { kind: 'plan', plan: planDraft() });
      const drafted = await get(featureId, context);

      expect(asked).toMatchObject({
        featureId,
        featureState: 'planning',
        runMode: 'manual',
        revision: null,
        turn: { kind: 'guided', status: 'succeeded' },
        questions: [
          { id: questionIds[0], answeredAt: null, recommended: 0 },
          { id: questionIds[1], answeredAt: null },
        ],
        decisions: [{ title: 'Server rendering', by: 'agent' }],
      });
      expect(asked.sections.find((entry) => entry.section === 'steps')?.status).toBe(
        'open_question',
      );
      expect(drafted).toMatchObject({
        revision: {
          number: 1,
          source: 'agent',
          acceptanceCriteria: [{ label: '1a', text: 'A plan renders as a PDF.' }],
          baseCommits: [{ commit: 'a'.repeat(40) }],
        },
        questions: [],
        decisions: [{ title: 'Server rendering' }],
        autoLoopStopped: false,
      });
      expect(drafted.readiness.every((item) => item.ok)).toBe(true);
      expect(drafted.sections.every((entry) => entry.status === 'complete')).toBe(true);
    });
  });

  describe('plan.answer', () => {
    it('queues a guided turn once the last open question is answered', async () => {
      const { userId, runnerId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      const { turnId, questionIds } = await scenario.askedQuestions(featureId, userId, runnerId);
      const [first, second] = questionIds;
      if (first === undefined || second === undefined) throw new Error('Two questions');

      const afterFirst = await call(
        router.plan.answer,
        { questionId: first, choice: 1 },
        { context },
      );
      const afterLast = await call(
        router.plan.answer,
        { questionId: second, text: 'Use both.' },
        { context },
      );

      const next = await latestTurn(database.db, featureId);
      expect(afterFirst.turn?.id).toBe(turnId);
      expect(afterLast.questions).toMatchObject([
        { answerChoice: 1, answerText: null },
        { answerChoice: null, answerText: 'Use both.' },
      ]);
      expect(next).toMatchObject({ kind: 'guided' });
      expect(next.id).not.toBe(turnId);
      expect(await runRow(database.db, next.runId)).toMatchObject({ status: 'queued', runnerId });
    });

    it.each([
      ['answers CONFLICT answered to an answered question', 'answered'],
      ['answers CONFLICT question_closed to a question a newer revision hides', 'question_closed'],
    ] as const)('%s', async (_name, reason) => {
      const { userId, runnerId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      const { questionIds } = await scenario.askedQuestions(featureId, userId, runnerId);
      const [first] = questionIds;
      if (first === undefined) throw new Error('A question');
      if (reason === 'answered') {
        await call(router.plan.answer, { questionId: first, choice: 0 }, { context });
      } else {
        await scenario.revision(featureId, userId);
      }

      await expect(
        call(router.plan.answer, { questionId: first, choice: 0 }, { context }),
      ).rejects.toMatchObject({ code: 'CONFLICT', data: { reason } });
    });

    it("answers INPUT_VALIDATION_FAILED to a choice past the question's choices", async () => {
      const { userId, runnerId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      const { questionIds } = await scenario.askedQuestions(featureId, userId, runnerId);

      await expect(
        call(router.plan.answer, { questionId: questionIds[0] ?? '', choice: 2 }, { context }),
      ).rejects.toMatchObject({
        code: 'INPUT_VALIDATION_FAILED',
        data: { fieldErrors: { choice: [expect.any(String)] } },
      });
    });

    it('answers RUNNER_REQUIRED to the last answer when the runner is revoked, storing nothing', async () => {
      const { userId, runnerId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      const { questionIds } = await scenario.askedQuestions(featureId, userId, runnerId, 1);
      await scenario.revoke(runnerId);

      await expect(
        call(router.plan.answer, { questionId: questionIds[0] ?? '', choice: 0 }, { context }),
      ).rejects.toMatchObject({ code: 'RUNNER_REQUIRED' });
      expect((await get(featureId, context)).questions).toMatchObject([{ answeredAt: null }]);
    });
  });

  describe('plan.revisions and plan.revision', () => {
    it('pages the revisions newest first and returns one by number', async () => {
      const { userId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      for (const number of [1, 2, 3]) await scenario.revision(featureId, userId, number);

      const first = await call(router.plan.revisions, { featureId, limit: 2 }, { context });
      const second = await call(
        router.plan.revisions,
        { featureId, limit: 2, cursor: first.nextCursor ?? undefined },
        { context },
      );
      const revision = await call(router.plan.revision, { featureId, number: 2 }, { context });

      expect(first.items.map((item) => item.number)).toEqual([3, 2]);
      expect(second).toEqual({
        items: [expect.objectContaining({ number: 1, source: 'engineer' })],
        nextCursor: null,
      });
      expect(revision).toMatchObject({
        number: 2,
        source: 'engineer',
        contextFiles: [],
        baseCommits: [],
      });
    });

    it('answers NOT_FOUND for an unknown revision number', async () => {
      const { userId, context } = await scenario.member();
      const featureId = await scenario.feature(userId);
      await scenario.revision(featureId, userId);

      await expect(
        call(router.plan.revision, { featureId, number: 2 }, { context }),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  it('answers NOT_FOUND to another user on every plan procedure', async () => {
    const { userId, runnerId } = await scenario.member();
    const { context } = await scenario.member();
    const featureId = await scenario.feature(userId);
    const body = await scenario.revision(featureId, userId);
    const { questionIds } = await scenario.askedQuestions(featureId, userId, runnerId);
    const questionId = questionIds[0] ?? '';
    const stepId = body.steps[0]?.id ?? '';
    const revision = 1;

    const calls = [
      call(router.plan.get, { featureId }, { context }),
      call(router.plan.answer, { questionId, choice: 0 }, { context }),
      call(router.plan.continue, { featureId }, { context }),
      call(router.plan.retry, { featureId }, { context }),
      call(router.plan.edit, { featureId, revision, body }, { context }),
      call(
        router.plan.sectionAction,
        { featureId, revision, section: 'goal', action: 'expand' },
        { context },
      ),
      call(
        router.plan.reviseStep,
        { featureId, revision, stepId, instruction: 'Shorter.' },
        { context },
      ),
      call(router.plan.markReady, { featureId, revision }, { context }),
      call(router.plan.revisions, { featureId }, { context }),
      call(router.plan.revision, { featureId, number: 1 }, { context }),
    ];

    for (const result of await Promise.allSettled(calls)) {
      expect(result).toMatchObject({ status: 'rejected', reason: { code: 'NOT_FOUND' } });
    }
  });
});
