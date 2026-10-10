import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { brokenConstraint } from '../test/broken-constraint.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { planBody, storeRevision, storeTurn } from '../test/planning.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import {
  contextFiles,
  features,
  planningTurnContextFiles,
  planningTurns,
  planQuestions,
  planRevisionContextFiles,
  planRevisionRepositories,
  planRevisions,
} from './schema.ts';

describe('planning schema constraints', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let userId: string;
  let runnerId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    runnerId = await storeRunner(database.db, { userId });
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  const feature = () => storeFeature(database.db, { authorId: userId, repositoryId });

  async function turnRow(overrides: Partial<typeof planningTurns.$inferInsert>) {
    const featureId = await feature();
    const { runId } = await storeTurn(deps, { featureId, userId, runnerId });
    const [stored] = await database.db
      .select()
      .from(planningTurns)
      .where(eq(planningTurns.runId, runId));
    if (stored === undefined) throw new Error('Turn not stored');
    await database.db.delete(planningTurns).where(eq(planningTurns.id, stored.id));
    return { ...stored, id: undefined, ...overrides };
  }

  it.each([
    [
      'a section action turn with no section',
      { kind: 'section_action' as const },
      'planning_turns_section_check',
    ],
    [
      'a revise-step turn with no step',
      { kind: 'revise_step' as const, instruction: 'Shorter.' },
      'planning_turns_step_id_check',
    ],
  ])('rejects %s', async (_name, overrides, constraint) => {
    expect(
      await brokenConstraint(database.db.insert(planningTurns).values(await turnRow(overrides))),
    ).toBe(constraint);
  });

  it('rejects a question with both answer columns set', async () => {
    const { turnId } = await storeTurn(deps, { featureId: await feature(), userId, runnerId });

    expect(
      await brokenConstraint(
        database.db.insert(planQuestions).values({
          turnId,
          position: 0,
          section: 'steps',
          prompt: 'Which store?',
          choices: [
            { label: 'Postgres', detail: '' },
            { label: 'S3', detail: '' },
          ],
          recommended: 0,
          answerChoice: 1,
          answerText: 'Both.',
          answeredAt: new Date(),
        }),
      ),
    ).toBe('plan_questions_answer_check');
  });

  it.each([
    ['an engineer revision with no author', 'engineer' as const, 'plan_revisions_author_id_check'],
    ['an agent revision with no turn', 'agent' as const, 'plan_revisions_turn_id_check'],
  ])('rejects %s', async (_name, source, constraint) => {
    const featureId = await feature();

    expect(
      await brokenConstraint(
        database.db
          .insert(planRevisions)
          .values({ featureId, number: 1, body: planBody(repositoryId), source }),
      ),
    ).toBe(constraint);
  });

  it('rejects a second revision with the same number', async () => {
    const featureId = await feature();
    await storeRevision(database.db, {
      featureId,
      body: planBody(repositoryId),
      number: 1,
      authorId: userId,
    });

    expect(
      await brokenConstraint(
        storeRevision(database.db, {
          featureId,
          body: planBody(repositoryId),
          number: 1,
          authorId: userId,
        }),
      ),
    ).toBe('plan_revisions_feature_id_number_key');
  });

  it('rejects a base commit that is not 40 hex characters', async () => {
    const featureId = await feature();
    const revisionId = await storeRevision(database.db, {
      featureId,
      body: planBody(repositoryId),
      number: 1,
      authorId: userId,
    });

    expect(
      await brokenConstraint(
        database.db
          .insert(planRevisionRepositories)
          .values({ revisionId, repositoryId, baseCommit: 'A'.repeat(40) }),
      ),
    ).toBe('plan_revision_repositories_base_commit_check');
  });

  /** A feature with a context file, a turn that read it with a question, and a revision built from it. */
  async function plannedFeature() {
    const featureId = await feature();
    const { taskId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    const [file] = await database.db
      .insert(contextFiles)
      .values({ taskId, title: 'Feature brief', content: '# Brief' })
      .returning({ id: contextFiles.id });
    if (file === undefined) throw new Error('Context file not stored');
    const { turnId } = await storeTurn(deps, { featureId, userId, runnerId });
    await database.db
      .insert(planningTurnContextFiles)
      .values({ turnId, contextFileId: file.id, title: 'Feature brief' });
    await database.db.insert(planQuestions).values({
      turnId,
      position: 0,
      section: 'goal',
      prompt: 'Why?',
      choices: [
        { label: 'A', detail: '' },
        { label: 'B', detail: '' },
      ],
      recommended: 0,
    });
    const revisionId = await storeRevision(database.db, {
      featureId,
      body: planBody(repositoryId),
      number: 1,
      turnId,
    });
    await database.db
      .insert(planRevisionContextFiles)
      .values({ revisionId, contextFileId: file.id, title: 'Feature brief' });
    await database.db
      .insert(planRevisionRepositories)
      .values({ revisionId, repositoryId, baseCommit: 'a'.repeat(40) });
    return { featureId, turnId, revisionId, contextFileId: file.id };
  }

  it('deletes the turns, questions, revisions and their rows with the feature', async () => {
    const { featureId, turnId, revisionId } = await plannedFeature();

    await database.db.delete(features).where(eq(features.id, featureId));

    const rows = await Promise.all([
      database.db.select({ n: count() }).from(planningTurns).where(eq(planningTurns.id, turnId)),
      database.db
        .select({ n: count() })
        .from(planQuestions)
        .where(eq(planQuestions.turnId, turnId)),
      database.db
        .select({ n: count() })
        .from(planningTurnContextFiles)
        .where(eq(planningTurnContextFiles.turnId, turnId)),
      database.db
        .select({ n: count() })
        .from(planRevisions)
        .where(eq(planRevisions.id, revisionId)),
      database.db
        .select({ n: count() })
        .from(planRevisionContextFiles)
        .where(eq(planRevisionContextFiles.revisionId, revisionId)),
      database.db
        .select({ n: count() })
        .from(planRevisionRepositories)
        .where(eq(planRevisionRepositories.revisionId, revisionId)),
    ]);
    expect(rows.map(([row]) => row?.n)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('deletes only the join rows of a deleted context file', async () => {
    const { turnId, revisionId, contextFileId } = await plannedFeature();

    await database.db.delete(contextFiles).where(eq(contextFiles.id, contextFileId));

    const rows = await Promise.all([
      database.db.select({ n: count() }).from(planningTurns).where(eq(planningTurns.id, turnId)),
      database.db
        .select({ n: count() })
        .from(planningTurnContextFiles)
        .where(eq(planningTurnContextFiles.turnId, turnId)),
      database.db
        .select({ n: count() })
        .from(planRevisions)
        .where(eq(planRevisions.id, revisionId)),
      database.db
        .select({ n: count() })
        .from(planRevisionContextFiles)
        .where(eq(planRevisionContextFiles.revisionId, revisionId)),
    ]);
    expect(rows.map(([row]) => row?.n)).toEqual([1, 0, 1, 0]);
  });
});
