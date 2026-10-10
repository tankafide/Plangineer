import { randomUUID } from 'node:crypto';
import { call } from '@orpc/server';
import type { FeatureState, PlanBody } from '@plangineer/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planScenarios } from '../test/plan-scenarios.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

/** What the plan holds before the procedure runs. */
interface Setup {
  state?: FeatureState;
  revisions?: number;
  stale?: boolean;
  turn?: 'none' | 'running' | 'failed' | 'questions' | 'answered';
  revoked?: boolean;
}

interface Plan {
  context: InitialContext;
  featureId: string;
  body: PlanBody;
  questionId: string;
}

type Procedure = (plan: Plan) => Promise<unknown>;

const answer: Procedure = ({ context, questionId }) =>
  call(router.plan.answer, { questionId, choice: 0 }, { context });
const continuePlan: Procedure = ({ context, featureId }) =>
  call(router.plan.continue, { featureId }, { context });
const retry: Procedure = ({ context, featureId }) =>
  call(router.plan.retry, { featureId }, { context });
const edit =
  (revision = 1): Procedure =>
  ({ context, featureId, body }) =>
    call(router.plan.edit, { featureId, revision, body }, { context });
const sectionAction =
  (revision = 1): Procedure =>
  ({ context, featureId }) =>
    call(
      router.plan.sectionAction,
      { featureId, revision, section: 'goal', action: 'regenerate' },
      { context },
    );
const reviseStep =
  (revision = 1, stepId?: string): Procedure =>
  ({ context, featureId, body }) =>
    call(
      router.plan.reviseStep,
      { featureId, revision, stepId: stepId ?? body.steps[0]?.id ?? '', instruction: 'Shorter.' },
      { context },
    );
const markReady =
  (revision = 1): Procedure =>
  ({ context, featureId }) =>
    call(router.plan.markReady, { featureId, revision }, { context });

const conflict = (reason: string) => ({ code: 'CONFLICT', data: { reason } });
const RUNNER_REQUIRED = { code: 'RUNNER_REQUIRED' };

const NOT_PLANNING: Setup = { state: 'plan_ready', turn: 'questions' };
const TURN_RUNNING: Setup = { turn: 'running' };
const QUESTIONS_OPEN: Setup = { turn: 'questions' };
const TWO_REVISIONS: Setup = { revisions: 2 };
const REVOKED: Setup = { revoked: true };

const cases: [string, Setup, Procedure, object][] = [
  ['plan.answer', NOT_PLANNING, answer, conflict('not_planning')],
  ['plan.answer', { turn: 'answered' }, answer, conflict('answered')],
  ['plan.answer', { turn: 'questions', revisions: 2 }, answer, conflict('question_closed')],
  ['plan.answer', { turn: 'questions', revoked: true }, answer, RUNNER_REQUIRED],
  ['plan.continue', NOT_PLANNING, continuePlan, conflict('not_planning')],
  ['plan.continue', TURN_RUNNING, continuePlan, conflict('turn_running')],
  ['plan.continue', QUESTIONS_OPEN, continuePlan, conflict('questions_open')],
  ['plan.continue', REVOKED, continuePlan, RUNNER_REQUIRED],
  ['plan.retry', { state: 'plan_ready', turn: 'failed' }, retry, conflict('not_planning')],
  ['plan.retry', {}, retry, conflict('nothing_to_retry')],
  ['plan.retry', { turn: 'failed', revoked: true }, retry, RUNNER_REQUIRED],
  ['plan.edit', NOT_PLANNING, edit(), conflict('not_planning')],
  ['plan.edit', TURN_RUNNING, edit(), conflict('turn_running')],
  ['plan.edit', QUESTIONS_OPEN, edit(), conflict('questions_open')],
  ['plan.edit', TWO_REVISIONS, edit(1), conflict('stale_revision')],
  ['plan.sectionAction', NOT_PLANNING, sectionAction(), conflict('not_planning')],
  ['plan.sectionAction', TURN_RUNNING, sectionAction(), conflict('turn_running')],
  ['plan.sectionAction', QUESTIONS_OPEN, sectionAction(), conflict('questions_open')],
  ['plan.sectionAction', TWO_REVISIONS, sectionAction(1), conflict('stale_revision')],
  ['plan.sectionAction', REVOKED, sectionAction(), RUNNER_REQUIRED],
  ['plan.reviseStep', NOT_PLANNING, reviseStep(), conflict('not_planning')],
  ['plan.reviseStep', TURN_RUNNING, reviseStep(), conflict('turn_running')],
  ['plan.reviseStep', QUESTIONS_OPEN, reviseStep(), conflict('questions_open')],
  ['plan.reviseStep', TWO_REVISIONS, reviseStep(1), conflict('stale_revision')],
  ['plan.reviseStep', REVOKED, reviseStep(), RUNNER_REQUIRED],
  ['plan.reviseStep', {}, reviseStep(1, randomUUID()), { code: 'NOT_FOUND' }],
  ['plan.markReady', NOT_PLANNING, markReady(), conflict('not_planning')],
  ['plan.markReady', TURN_RUNNING, markReady(), conflict('turn_running')],
  ['plan.markReady', QUESTIONS_OPEN, markReady(), conflict('questions_open')],
  ['plan.markReady', TWO_REVISIONS, markReady(1), conflict('stale_revision')],
  ['plan.markReady', { stale: true }, markReady(), conflict('not_ready')],
];

describe('plan write errors', () => {
  let database: TestDatabase;
  let scenario: ReturnType<typeof planScenarios>;

  beforeAll(async () => {
    database = await createTestDatabase();
    const admin = await storeUser(testAuth(database.db), { role: 'admin' });
    scenario = planScenarios(
      testDeps(database.db),
      await storeRepository(database.db, { createdBy: admin.id }),
    );
  });

  afterAll(async () => {
    await database.drop();
  });

  /** A member's feature with its revisions first, then its latest turn, then a revoked runner. */
  async function arrange(setup: Setup): Promise<Plan> {
    const { userId, runnerId, context } = await scenario.member();
    const featureId = await scenario.feature(userId, { state: setup.state ?? 'planning' });
    const body = await scenario.revision(
      featureId,
      userId,
      1,
      setup.stale === true ? scenario.staleBody() : undefined,
    );
    let questionId = '';
    if (setup.turn === 'questions' || setup.turn === 'answered') {
      [questionId = ''] = (
        await scenario.askedQuestions(featureId, userId, runnerId, 1)
      ).questionIds;
      if (setup.turn === 'answered') await answer({ context, featureId, body, questionId });
    }
    if (setup.turn === 'running') await scenario.queuedTurn(featureId, userId, runnerId);
    if (setup.turn === 'failed') await scenario.failedTurn(featureId, userId, runnerId);
    if (setup.revisions === 2) await scenario.revision(featureId, userId, 2, body);
    if (setup.revoked === true) await scenario.revoke(runnerId);
    return { context, featureId, body, questionId };
  }

  it.each(
    cases.map(([name, setup, procedure, expected]) => [name, expected, setup, procedure] as const),
  )('%s answers %j', async (_name, expected, setup, procedure) => {
    const plan = await arrange(setup);

    await expect(procedure(plan)).rejects.toMatchObject(expected);
  });
});
