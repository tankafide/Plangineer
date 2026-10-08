import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createNotificationListener,
  type NotificationListener,
} from '../realtime/notifications.ts';
import { silentLogger, testDeps } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { createRunEventTail } from './run-event-tail.ts';
import { RunNotFoundError } from './run-repository.ts';

describe('createRunEventTail', () => {
  let database: TestDatabase;
  let listener: NotificationListener;

  beforeAll(async () => {
    database = await createTestDatabase();
    listener = await createNotificationListener({
      databaseUrl: database.url,
      logger: silentLogger,
    });
  });

  afterAll(async () => {
    await listener.close();
    await database.drop();
  });

  it('refuses to subscribe a stream to a run that does not exist', async () => {
    const tail = createRunEventTail({ deps: testDeps(database.db), listener });

    await expect(
      tail.subscribe(randomUUID(), { deliver: () => undefined, end: () => undefined }),
    ).rejects.toBeInstanceOf(RunNotFoundError);
    tail.close();
  });
});
