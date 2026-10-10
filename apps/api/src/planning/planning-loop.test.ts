import { PlanBody, type PlanDraft } from '@plangineer/contracts';
import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { features, planningTurns, runners } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { onRunEnded } from '../runs/run-ended.ts';
import { storeFeature } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { finishTurn, latestTurn, planDraft, revisionsOf, storeTurn } from '../test/planning.ts';
import {
  appendRunnerEvents,
  planningOutputEvent,
  runRow,
  startedEvent,
  succeededEvent,
} from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

/** A draft whose one step has no file, so the readiness checklist fails. */
const unreadyDraft = (): PlanDraft =>
  planDraft({
    steps: [
      {
        id: 'new-1',
        title: 'Render the PDF',
        files: [],
        body: 'Render the plan.',
        doneWhen: [{ id: 'new-2', text: 'A plan renders as a PDF.' }],
      },
    ],
  });

describe('the Auto loop after a guided draft', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let userId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  /** An Auto loop feature in planning with a queued guided turn on a fresh runner. */
  async function autoLoop() {
    const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 16 });
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'planning',
      runMode: 'auto_loop',
    });
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId, runMode: 'auto_loop' });
    return { featureId, runnerId, runId };
  }

  const stateOf = async (featureId: string) => {
    const [row] = await database.db
      .select({ state: features.state })
      .from(features)
      .where(eq(features.id, featureId));
    return row?.state;
  };

  const turnCount = async (featureId: string) => {
    const [row] = await database.db
      .select({ n: count() })
      .from(planningTurns)
      .where(eq(planningTurns.featureId, featureId));
    return row?.n;
  };

  /** Runs the feature's newest turn to the given output. */
  async function draft(featureId: string, runnerId: string, plan: PlanDraft) {
    const turn = await latestTurn(database.db, featureId);
    await finishTurn(deps, runnerId, turn.runId, { kind: 'plan', plan });
    return turn;
  }

  it('moves a ready draft to ready_for_review and queues no turn', async () => {
    const { featureId, runnerId, runId } = await autoLoop();

    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: planDraft() });

    expect([await stateOf(featureId), await turnCount(featureId)]).toEqual(['ready_for_review', 1]);
  });

  it('queues another guided turn on the same runner after an unready draft', async () => {
    const { featureId, runnerId, runId } = await autoLoop();

    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: unreadyDraft() });

    const next = await latestTurn(database.db, featureId);
    expect(await stateOf(featureId)).toBe('planning');
    expect(next.runId).not.toBe(runId);
    expect(next.job.settings.planCheckIn).toBe('skip');
    expect(await runRow(database.db, next.runId)).toMatchObject({ status: 'queued', runnerId });
  });

  it('reaches ready_for_review on a redraft that changes a step and its coverage', async () => {
    const { featureId, runnerId, runId } = await autoLoop();
    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: unreadyDraft() });
    const [first] = await revisionsOf(database.db, featureId);
    const [step] = PlanBody.parse(first?.body).steps;
    if (step === undefined) throw new Error('The first draft has a step');
    const [line] = step.doneWhen;
    if (line === undefined) throw new Error('The step has a line');

    await draft(featureId, runnerId, {
      ...planDraft(),
      steps: [
        {
          id: step.id,
          title: 'Render the PDF on the server',
          files: ['apps/api/src/pdf.ts'],
          body: step.body,
          doneWhen: step.doneWhen,
        },
      ],
      coverage: [{ lineId: line.id, ticks: ['unit', 'integration'] }],
    });

    const [, second] = await revisionsOf(database.db, featureId);
    expect(PlanBody.parse(second?.body).coverage).toEqual([
      { lineId: line.id, ticks: ['unit', 'integration'], stale: false },
    ]);
    expect(await stateOf(featureId)).toBe('ready_for_review');
  });

  it('queues no turn after the third unready draft in a row', async () => {
    const { featureId, runnerId, runId } = await autoLoop();
    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: unreadyDraft() });
    await draft(featureId, runnerId, unreadyDraft());

    const third = await draft(featureId, runnerId, unreadyDraft());

    expect((await latestTurn(database.db, featureId)).id).toBe(third.id);
    expect([await stateOf(featureId), await turnCount(featureId)]).toEqual(['planning', 3]);
  });

  it('waits for a runner row another transaction holds, then queues the next turn', async () => {
    const { featureId, runnerId, runId } = await autoLoop();
    await claimRuns(deps, runnerId);

    let ended: Promise<void> | undefined;
    await database.db.transaction(async (tx) => {
      // The row lock a runner's pong takes while the run ends.
      await tx.select().from(runners).where(eq(runners.id, runnerId)).for('no key update');
      await appendRunnerEvents(deps, runId, [
        startedEvent,
        planningOutputEvent({ kind: 'plan', plan: unreadyDraft() }),
        succeededEvent,
      ]);
      ended = onRunEnded(deps, runId);
      // Long enough for the continuation to reach the runner lock and wait on it.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await turnCount(featureId)).toBe(1);
    });
    await ended;

    const next = await latestTurn(database.db, featureId);
    expect(next.runId).not.toBe(runId);
    expect(await runRow(database.db, next.runId)).toMatchObject({ status: 'queued', runnerId });
  });

  it('queues no turn when the runner was revoked, and the feature waits in planning', async () => {
    const { featureId, runnerId, runId } = await autoLoop();
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [startedEvent]);
    await database.db
      .update(runners)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(eq(runners.id, runnerId));

    await appendRunnerEvents(
      deps,
      runId,
      [planningOutputEvent({ kind: 'plan', plan: unreadyDraft() }), succeededEvent],
      2,
    );
    await onRunEnded(deps, runId);

    expect((await runRow(database.db, runId)).status).toBe('succeeded');
    expect([await stateOf(featureId), await turnCount(featureId)]).toEqual(['planning', 1]);
  });
});
