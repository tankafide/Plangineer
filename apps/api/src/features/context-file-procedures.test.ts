import { call } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextFiles } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('context file procedures', () => {
  let database: TestDatabase;
  let deps: ServiceDeps;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    deps = testDeps(database.db);
    const admin = await storeUser(testAuth(database.db), { role: 'admin' });
    repositoryId = await storeRepository(database.db, { createdBy: admin.id });
  });

  afterAll(async () => {
    await database.drop();
  });

  async function viewer() {
    const stored = await storeUser(testAuth(database.db), { role: 'member' });
    const context: InitialContext = {
      ...deps,
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'member' } },
    };
    return { userId: stored.id, context };
  }

  /** The viewer's feature with one intake task and its context file. */
  async function storedFile() {
    const { userId, context } = await viewer();
    const runnerId = await storeRunner(database.db, { userId });
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const { taskId } = await storeTask(deps, { featureId, repositoryId, userId, runnerId });
    const [row] = await database.db
      .insert(contextFiles)
      .values({ taskId, title: 'Feature brief', content: '# Feature brief' })
      .returning({ id: contextFiles.id });
    return { contextFileId: row?.id ?? '', featureId, taskId, context };
  }

  it('returns the file with its feature and content', async () => {
    const { contextFileId, featureId, taskId, context } = await storedFile();

    const file = await call(router.contextFile.get, { contextFileId }, { context });

    expect(file).toEqual({
      id: contextFileId,
      taskId,
      featureId,
      title: 'Feature brief',
      content: '# Feature brief',
      ticked: true,
      updatedAt: expect.any(String),
    });
  });

  it('renames, edits and unticks a file', async () => {
    const { contextFileId, context } = await storedFile();

    const updated = await call(
      router.contextFile.update,
      { contextFileId, title: 'Brief', content: '# Brief\n\nEdited.', ticked: false },
      { context },
    );

    expect(updated).toMatchObject({
      title: 'Brief',
      content: '# Brief\n\nEdited.',
      ticked: false,
    });
    expect(await call(router.contextFile.get, { contextFileId }, { context })).toEqual(updated);
  });

  it.each([
    ['empty content', { content: '' }],
    ['no field', {}],
  ])('rejects an update with %s and changes nothing', async (_name, change) => {
    const { contextFileId, context } = await storedFile();

    await expect(
      call(router.contextFile.update, { contextFileId, ...change }, { context }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect((await call(router.contextFile.get, { contextFileId }, { context })).content).toBe(
      '# Feature brief',
    );
  });

  it('deletes the file', async () => {
    const { contextFileId, context } = await storedFile();

    const deleted = await call(router.contextFile.delete, { contextFileId }, { context });

    expect(deleted).toEqual({ id: contextFileId });
    expect(
      await database.db.select().from(contextFiles).where(eq(contextFiles.id, contextFileId)),
    ).toEqual([]);
  });

  it('answers NOT_FOUND to another user on get, update and delete, and keeps the file', async () => {
    const { contextFileId } = await storedFile();
    const { context } = await viewer();

    await expect(
      call(router.contextFile.get, { contextFileId }, { context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      call(router.contextFile.update, { contextFileId, ticked: false }, { context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      call(router.contextFile.delete, { contextFileId }, { context }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const [row] = await database.db
      .select({ ticked: contextFiles.ticked })
      .from(contextFiles)
      .where(eq(contextFiles.id, contextFileId));
    expect(row).toEqual({ ticked: true });
  });
});
