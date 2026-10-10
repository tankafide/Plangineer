import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { brokenConstraint } from '../test/broken-constraint.ts';
import { storeFeature, storeTask, testPrePlanningJob } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import {
  contextFiles,
  featureAttachments,
  featureRepositories,
  features,
  prePlanningTasks,
  repositories,
  runs,
} from './schema.ts';

describe('feature schema constraints', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let userId: string;
  let runnerId: string;
  let githubRepositoryId = 6000;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    runnerId = await storeRunner(database.db, { userId });
  });

  afterAll(async () => {
    await database.drop();
  });

  async function featureOnNewRepository() {
    githubRepositoryId += 1;
    const repositoryId = await storeRepository(database.db, {
      createdBy: userId,
      githubRepositoryId,
    });
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    return { featureId, repositoryId };
  }

  async function queuedRunId(): Promise<string> {
    const [row] = await database.db
      .insert(runs)
      .values({
        kind: 'pre_planning',
        userId,
        runnerId,
        repositoryOwner: 'acme',
        repositoryName: 'app',
        ref: 'main',
        prompt: 'Write the brief.',
      })
      .returning({ id: runs.id });
    if (row === undefined) throw new Error('Run insert returned no row');
    return row.id;
  }

  const task = async (
    featureId: string,
    repositoryId: string,
    overrides: Partial<typeof prePlanningTasks.$inferInsert> = {},
  ) => ({
    featureId,
    repositoryId,
    kind: 'intake' as const,
    topic: null,
    job: testPrePlanningJob(),
    runId: await queuedRunId(),
    ...overrides,
  });

  it.each([
    ['a research task with no topic', { kind: 'research' as const, topic: null }],
    ['an exploration task with a topic', { kind: 'exploration' as const, topic: 'Contrast' }],
  ])('rejects %s', async (_name, overrides) => {
    const { featureId, repositoryId } = await featureOnNewRepository();

    expect(
      await brokenConstraint(
        database.db.insert(prePlanningTasks).values(await task(featureId, repositoryId, overrides)),
      ),
    ).toBe('pre_planning_tasks_topic_check');
  });

  it('rejects a task on a repository its feature does not involve', async () => {
    const { featureId } = await featureOnNewRepository();
    const other = await featureOnNewRepository();

    expect(
      await brokenConstraint(
        database.db.insert(prePlanningTasks).values(await task(featureId, other.repositoryId)),
      ),
    ).toBe('pre_planning_tasks_feature_repository_fk');
  });

  it('rejects an attachment whose size differs from its content length', async () => {
    const { featureId } = await featureOnNewRepository();

    expect(
      await brokenConstraint(
        database.db.insert(featureAttachments).values({
          featureId,
          name: 'notes.txt',
          mediaType: 'text/plain',
          sizeBytes: 4,
          content: Buffer.from('abc'),
        }),
      ),
    ).toBe('feature_attachments_size_bytes_check');
  });

  it('rejects a second context file for one task', async () => {
    const { featureId, repositoryId } = await featureOnNewRepository();
    const { taskId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    const file = { taskId, title: 'Feature brief', content: '# Feature brief' };
    await database.db.insert(contextFiles).values(file);

    expect(await brokenConstraint(database.db.insert(contextFiles).values(file))).toBe(
      'context_files_task_id_key',
    );
  });

  it('deletes a feature with its repository rows, attachments, tasks and context files, and keeps its runs', async () => {
    const { featureId, repositoryId } = await featureOnNewRepository();
    const { taskId, runId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    await database.db.insert(featureAttachments).values({
      featureId,
      name: 'notes.txt',
      mediaType: 'text/plain',
      sizeBytes: 3,
      content: Buffer.from('abc'),
    });
    await database.db
      .insert(contextFiles)
      .values({ taskId, title: 'Feature brief', content: '# Feature brief' });

    await database.db.delete(features).where(eq(features.id, featureId));

    const left = async (table: typeof featureRepositories | typeof featureAttachments) =>
      (
        await database.db.select({ n: count() }).from(table).where(eq(table.featureId, featureId))
      )[0]?.n;
    expect(await left(featureRepositories)).toBe(0);
    expect(await left(featureAttachments)).toBe(0);
    expect(
      await database.db.select().from(prePlanningTasks).where(eq(prePlanningTasks.id, taskId)),
    ).toEqual([]);
    expect(
      await database.db.select().from(contextFiles).where(eq(contextFiles.taskId, taskId)),
    ).toEqual([]);
    expect(await database.db.select({ id: runs.id }).from(runs).where(eq(runs.id, runId))).toEqual([
      { id: runId },
    ]);
  });

  it('refuses to delete a repository a feature involves', async () => {
    const { repositoryId } = await featureOnNewRepository();

    expect(
      await brokenConstraint(
        database.db.delete(repositories).where(eq(repositories.id, repositoryId)),
      ),
    ).toBe('feature_repositories_repository_id_repositories_id_fk');
  });
});
