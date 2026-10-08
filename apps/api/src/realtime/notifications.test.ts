import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { silentLogger } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import {
  createNotificationListener,
  type NotificationChannel,
  type NotificationListener,
  RUN_EVENTS_CHANNEL,
  RUNNER_WAKE_CHANNEL,
} from './notifications.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

describe('createNotificationListener', () => {
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

  const notify = (channel: NotificationChannel) =>
    database.db.execute(sql`SELECT pg_notify(${channel}, ${ID})`);

  it.each<NotificationChannel>([RUNNER_WAKE_CHANNEL, RUN_EVENTS_CHANNEL])(
    'delivers a %s payload to its subscriber',
    async (channel) => {
      const onNotify = vi.fn<(payload: string) => void>();
      const unsubscribe = listener.subscribe(channel, {
        onNotify,
        onReconnect: vi.fn<() => void>(),
      });

      await notify(channel);

      await vi.waitFor(() => expect(onNotify).toHaveBeenCalledWith(ID));
      unsubscribe();
    },
  );

  it('stops delivering after unsubscribe', async () => {
    const onNotify = vi.fn<(payload: string) => void>();
    const witness = vi.fn<(payload: string) => void>();
    listener.subscribe(RUNNER_WAKE_CHANNEL, {
      onNotify: witness,
      onReconnect: vi.fn<() => void>(),
    });
    listener.subscribe(RUNNER_WAKE_CHANNEL, { onNotify, onReconnect: vi.fn<() => void>() })();

    await notify(RUNNER_WAKE_CHANNEL);

    await vi.waitFor(() => expect(witness).toHaveBeenCalled());
    expect(onNotify).not.toHaveBeenCalled();
  });

  it('reconnects after its connection is terminated, then calls onReconnect', async () => {
    const onNotify = vi.fn<(payload: string) => void>();
    const onReconnect = vi.fn<() => void>();
    listener.subscribe(RUN_EVENTS_CHANNEL, { onNotify, onReconnect });

    await database.db.execute(
      sql`SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE application_name = 'plangineer-listener' AND datname = current_database()`,
    );

    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledOnce(), { timeout: 5_000 });
    await notify(RUN_EVENTS_CHANNEL);
    await vi.waitFor(() => expect(onNotify).toHaveBeenCalledWith(ID));
  });
});
