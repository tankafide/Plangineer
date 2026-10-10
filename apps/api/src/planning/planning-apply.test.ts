import { PLAN_BODY_MAX_BYTES, PlanBody } from '@plangineer/contracts';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contextFiles,
  planningTurnContextFiles,
  planningTurns,
  planQuestions,
  planRevisionContextFiles,
  planRevisionRepositories,
} from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  finishTurn,
  planBody,
  planBodyOfSize,
  planDraft,
  questionsOutput,
  revisionsOf,
  storeRevision,
  storeTurn,
} from '../test/planning.ts';
import {
  appendRunnerEvents,
  planningOutputEvent,
  runRow,
  startedEvent,
  storedEvents,
  succeededEvent,
} from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('applying a planning output', () => {
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

  /** A planning feature and a runner of its author. */
  async function planning() {
    const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 16 });
    const featureId = await storeFeature(database.db, {
      authorId: userId,
      repositoryId,
      state: 'planning',
    });
    return { featureId, runnerId };
  }

  async function failure(runId: string) {
    const last = (await storedEvents(database.db, runId)).at(-1);
    return { status: (await runRow(database.db, runId)).status, event: last?.payload };
  }

  it('stores the questions of a questions output at their positions with the decisions given fresh ids', async () => {
    const { featureId, runnerId } = await planning();
    const { turnId, runId } = await storeTurn(deps, { featureId, userId, runnerId });

    await finishTurn(deps, runnerId, runId, questionsOutput(2));

    const questions = await database.db
      .select({ position: planQuestions.position, prompt: planQuestions.prompt })
      .from(planQuestions)
      .where(eq(planQuestions.turnId, turnId))
      .orderBy(asc(planQuestions.position));
    const [turn] = await database.db
      .select({ decisions: planningTurns.decisions })
      .from(planningTurns)
      .where(eq(planningTurns.id, turnId));
    expect((await runRow(database.db, runId)).status).toBe('succeeded');
    expect(questions).toEqual([
      { position: 0, prompt: 'Which store? (1)' },
      { position: 1, prompt: 'Which store? (2)' },
    ]);
    expect(turn?.decisions).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Server rendering',
        reason: 'Fonts match.',
        by: 'agent',
      },
    ]);
  });

  it('stores a plan output as revision 1 with the context files the turn read and the run commit', async () => {
    const { featureId, runnerId } = await planning();
    const { taskId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    const [file] = await database.db
      .insert(contextFiles)
      .values({ taskId, title: 'Feature brief', content: '# Brief' })
      .returning({ id: contextFiles.id });
    if (file === undefined) throw new Error('Context file not stored');
    const { turnId, runId } = await storeTurn(deps, { featureId, userId, runnerId });
    await database.db
      .insert(planningTurnContextFiles)
      .values({ turnId, contextFileId: file.id, title: 'Feature brief' });

    await finishTurn(deps, runnerId, runId, { kind: 'plan', plan: planDraft() });

    const [revision] = await revisionsOf(database.db, featureId);
    if (revision === undefined) throw new Error('No revision stored');
    const files = await database.db
      .select({
        contextFileId: planRevisionContextFiles.contextFileId,
        title: planRevisionContextFiles.title,
      })
      .from(planRevisionContextFiles)
      .where(eq(planRevisionContextFiles.revisionId, revision.id));
    const commits = await database.db
      .select({
        repositoryId: planRevisionRepositories.repositoryId,
        baseCommit: planRevisionRepositories.baseCommit,
      })
      .from(planRevisionRepositories)
      .where(eq(planRevisionRepositories.revisionId, revision.id));
    expect(revision).toMatchObject({ number: 1, source: 'agent', turnId, authorId: null });
    expect(PlanBody.parse(revision.body).steps[0]).toMatchObject({
      title: 'Render the PDF',
      repositoryId,
    });
    expect(files).toEqual([{ contextFileId: file.id, title: 'Feature brief' }]);
    expect(commits).toEqual([{ repositoryId, baseCommit: 'a'.repeat(40) }]);
  });

  it('changes only the patched section in a new revision', async () => {
    const { featureId, runnerId } = await planning();
    const body = planBody(repositoryId);
    await storeRevision(database.db, { featureId, body, number: 1, authorId: userId });
    const { runId } = await storeTurn(deps, {
      featureId,
      userId,
      runnerId,
      spec: { kind: 'section_action', section: 'goal', action: 'expand' },
    });

    await finishTurn(deps, runnerId, runId, {
      kind: 'section',
      patch: { section: 'goal', goal: 'Let engineers export a plan as PDF, with fonts.' },
    });

    const [, second] = await revisionsOf(database.db, featureId);
    expect(second?.number).toBe(2);
    expect(PlanBody.parse(second?.body)).toEqual(
      PlanBody.parse({ ...body, goal: 'Let engineers export a plan as PDF, with fonts.' }),
    );
  });

  it('replaces only the revised step and marks its coverage rows stale', async () => {
    const { featureId, runnerId } = await planning();
    const body = planBody(repositoryId);
    const [first, second] = body.steps;
    if (first === undefined || second === undefined) throw new Error('Fixture has two steps');
    await storeRevision(database.db, { featureId, body, number: 1, authorId: userId });
    const { runId } = await storeTurn(deps, {
      featureId,
      userId,
      runnerId,
      spec: { kind: 'revise_step', stepId: first.id, instruction: 'Name it better.' },
    });

    await finishTurn(deps, runnerId, runId, {
      kind: 'step',
      step: {
        id: first.id,
        title: 'Render the PDF (revised)',
        files: first.files,
        body: first.body,
        doneWhen: first.doneWhen,
      },
    });

    const [, revised] = await revisionsOf(database.db, featureId);
    const stored = PlanBody.parse(revised?.body);
    const staleLines = new Set(first.doneWhen.map((line) => line.id));
    const before = PlanBody.parse(body).steps;
    expect(stored.steps).toEqual([{ ...before[0], title: 'Render the PDF (revised)' }, before[1]]);
    expect(stored.coverage.map((row) => row.stale)).toEqual(
      body.coverage.map((row) => staleLines.has(row.lineId)),
    );
  });

  it('fails a questions output under Auto loop with invalid_output and stores nothing', async () => {
    const { featureId, runnerId } = await planning();
    const { turnId, runId } = await storeTurn(deps, {
      featureId,
      userId,
      runnerId,
      runMode: 'auto_loop',
    });

    await finishTurn(deps, runnerId, runId, questionsOutput());

    const questions = await database.db
      .select()
      .from(planQuestions)
      .where(eq(planQuestions.turnId, turnId));
    expect(await failure(runId)).toMatchObject({
      status: 'failed',
      event: { type: 'run.failed', reason: 'invalid_output' },
    });
    expect(questions).toEqual([]);
  });

  it('fails a section patch whose merged body passes 256 KiB with invalid_output and stores no revision', async () => {
    const { featureId, runnerId } = await planning();
    const body = planBodyOfSize(repositoryId, PLAN_BODY_MAX_BYTES - 100);
    await storeRevision(database.db, {
      featureId,
      body: PlanBody.parse(body),
      number: 1,
      authorId: userId,
    });
    const { runId } = await storeTurn(deps, {
      featureId,
      userId,
      runnerId,
      spec: { kind: 'section_action', section: 'goal', action: 'expand' },
    });

    await finishTurn(deps, runnerId, runId, {
      kind: 'section',
      patch: { section: 'goal', goal: 'g'.repeat(4_000) },
    });

    expect(await failure(runId)).toMatchObject({
      status: 'failed',
      event: { reason: 'invalid_output', message: expect.stringContaining('262144 bytes') },
    });
    expect(await revisionsOf(database.db, featureId)).toHaveLength(1);
  });

  it('fails a planning run.succeeded with no planning.output with protocol_error', async () => {
    const { featureId, runnerId } = await planning();
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    await claimRuns(deps, runnerId);

    await appendRunnerEvents(deps, runId, [startedEvent, succeededEvent]);

    expect(await failure(runId)).toMatchObject({
      status: 'failed',
      event: { reason: 'protocol_error', message: expect.stringContaining('no planning.output') },
    });
    expect(await revisionsOf(database.db, featureId)).toEqual([]);
  });

  it('applies a planning.output stored in an earlier batch than its run.succeeded', async () => {
    const { featureId, runnerId } = await planning();
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, runId, [
      startedEvent,
      planningOutputEvent({ kind: 'plan', plan: planDraft() }),
    ]);

    await appendRunnerEvents(deps, runId, [succeededEvent], 3);

    expect((await runRow(database.db, runId)).status).toBe('succeeded');
    expect(await revisionsOf(database.db, featureId)).toHaveLength(1);
  });

  it.each([
    ['in one batch', 1],
    ['in a later batch', 2],
  ])('fails the run with protocol_error on a second planning.output %s', async (_name, batches) => {
    const { featureId, runnerId } = await planning();
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    const output = planningOutputEvent({ kind: 'plan', plan: planDraft() });
    await claimRuns(deps, runnerId);

    if (batches === 1) {
      await appendRunnerEvents(deps, runId, [startedEvent, output, output, succeededEvent]);
    } else {
      await appendRunnerEvents(deps, runId, [startedEvent, output]);
      await appendRunnerEvents(deps, runId, [output, succeededEvent], 3);
    }

    expect(await failure(runId)).toMatchObject({
      status: 'failed',
      event: { reason: 'protocol_error', message: 'The runner sent a second planning.output.' },
    });
    expect(await revisionsOf(database.db, featureId)).toEqual([]);
  });
});
