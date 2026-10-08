import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createNotificationListener,
  type NotificationListener,
} from '../realtime/notifications.ts';
import { silentLogger, storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { createRunnerConnections, type HeldSocket } from './runner-connections.ts';

const heldSocket = (): HeldSocket => ({
  send: vi.fn<HeldSocket['send']>(),
  close: vi.fn<HeldSocket['close']>(),
});

describe('createRunnerConnections', () => {
  let database: TestDatabase;
  let listener: NotificationListener;
  let userId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    listener = await createNotificationListener({
      databaseUrl: database.url,
      logger: silentLogger,
    });
    userId = (await storeUser(testAuth(database.db))).id;
  });

  afterAll(async () => {
    await listener.close();
    await database.drop();
  });

  it('closes a socket with 4001 when its runner was revoked before the attach', async () => {
    const connections = createRunnerConnections({ deps: testDeps(database.db), listener });
    const runnerId = await storeRunner(database.db, {
      userId,
      status: 'revoked',
      revokedAt: new Date(),
    });
    const socket = heldSocket();

    connections.attach(runnerId, socket);

    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledWith(4001, 'Runner revoked'));
    await connections.close();
  });

  it('keeps a socket of an active runner open', async () => {
    const connections = createRunnerConnections({ deps: testDeps(database.db), listener });
    const runnerId = await storeRunner(database.db, { userId });
    const socket = heldSocket();

    connections.attach(runnerId, socket);
    await connections.dispatch(runnerId);

    expect(socket.close).not.toHaveBeenCalled();
    await connections.close();
    expect(socket.close).toHaveBeenCalledWith(1001, 'Server shutting down');
  });
});
