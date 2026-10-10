import { randomBytes } from 'node:crypto';
import { runnerAttachmentPath } from '@plangineer/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureAttachments } from '../db/schema.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { storeFeature, storeTask } from '../test/features.ts';
import { storeRunnerWithToken, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, startedEvent, succeededEvent } from '../test/runs.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('GET /api/runners/attachments/:attachmentId', () => {
  let database: TestDatabase;
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let deps: ServiceDeps;
  let userId: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database);
    deps = testDeps(database.db);
    userId = (await storeUser(testAuth(database.db))).id;
    repositoryId = await storeRepository(database.db, { createdBy: userId });
  });

  afterAll(async () => {
    await testApp.close();
    await database.drop();
  });

  const runner = () => storeRunnerWithToken(database.db, { userId, concurrencyLimit: 16 });

  /** A feature with one PNG attachment. */
  async function featureWithAttachment() {
    const featureId = await storeFeature(database.db, { authorId: userId, repositoryId });
    const content = randomBytes(2048);
    const [row] = await database.db
      .insert(featureAttachments)
      .values({
        featureId,
        name: 'screen.png',
        mediaType: 'image/png',
        sizeBytes: content.length,
        content,
      })
      .returning({ id: featureAttachments.id });
    return { featureId, attachmentId: row?.id ?? '', content };
  }

  /** A task of the feature whose run the runner has claimed and started. */
  async function runningTask(
    featureId: string,
    runnerId: string,
    kind: 'intake' | 'research' = 'intake',
  ) {
    const task = await storeTask(deps, { featureId, repositoryId, userId, runnerId, kind });
    await claimRuns(deps, runnerId);
    await appendRunnerEvents(deps, task.runId, [startedEvent]);
    return task;
  }

  const download = (attachmentId: string, token: string) =>
    testApp.app.request(runnerAttachmentPath(attachmentId), {
      headers: { authorization: `Bearer ${token}` },
    });

  it('answers the exact bytes with their media type to the runner holding a running intake run', async () => {
    const { runnerId, token } = await runner();
    const { featureId, attachmentId, content } = await featureWithAttachment();
    await runningTask(featureId, runnerId);

    const response = await download(attachmentId, token);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await response.arrayBuffer()).equals(content)).toBe(true);
  });

  it('answers 401 to a bad token', async () => {
    const { attachmentId } = await featureWithAttachment();

    const response = await download(attachmentId, 'not-a-runner-token');

    expect(response.status).toBe(401);
  });

  it('answers 404 to another runner', async () => {
    const holder = await runner();
    const other = await runner();
    const { featureId, attachmentId } = await featureWithAttachment();
    await runningTask(featureId, holder.runnerId);

    expect((await download(attachmentId, other.token)).status).toBe(404);
  });

  it('answers 404 once the intake run has ended', async () => {
    const { runnerId, token } = await runner();
    const { featureId, attachmentId } = await featureWithAttachment();
    const { runId } = await runningTask(featureId, runnerId);
    await appendRunnerEvents(deps, runId, [succeededEvent], 2);

    expect((await download(attachmentId, token)).status).toBe(404);
  });

  it("answers 404 to a runner holding only a running research task of the attachment's feature", async () => {
    const intakeRunner = await runner();
    const researchRunner = await runner();
    const { featureId, attachmentId } = await featureWithAttachment();
    await storeTask(deps, { featureId, repositoryId, userId, runnerId: intakeRunner.runnerId });
    await runningTask(featureId, researchRunner.runnerId, 'research');

    expect((await download(attachmentId, researchRunner.token)).status).toBe(404);
  });

  it("answers 404 for another feature's attachment, and for an id that is not a uuid", async () => {
    const { runnerId, token } = await runner();
    const held = await featureWithAttachment();
    const other = await featureWithAttachment();
    await runningTask(held.featureId, runnerId);

    expect((await download(other.attachmentId, token)).status).toBe(404);
    expect((await download('not-a-uuid', token)).status).toBe(404);
  });
});
