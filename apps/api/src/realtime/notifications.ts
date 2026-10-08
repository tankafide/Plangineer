import { Client, type Notification } from 'pg';
import type { Logger } from '../logger.ts';

export const RUN_EVENTS_CHANNEL = 'run_events';
export const RUNNER_WAKE_CHANNEL = 'runner_wake';

export type NotificationChannel = typeof RUN_EVENTS_CHANNEL | typeof RUNNER_WAKE_CHANNEL;

const CHANNELS: readonly NotificationChannel[] = [RUN_EVENTS_CHANNEL, RUNNER_WAKE_CHANNEL];
const FIRST_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const APPLICATION_NAME = 'plangineer-listener';

interface ChannelSubscriber {
  /** Receives each notification's payload: a run id or a runner id. */
  onNotify: (payload: string) => void;
  /** Runs after a reconnect, so the subscriber can catch up on what it missed. */
  onReconnect: () => void;
}

export interface NotificationListener {
  subscribe: (channel: NotificationChannel, subscriber: ChannelSubscriber) => () => void;
  close: () => Promise<void>;
}

/** Ends a connection that is no longer wanted, ignoring its late errors. */
async function release(connection: Client): Promise<void> {
  connection.removeAllListeners();
  connection.on('error', () => undefined);
  await connection.end().catch(() => undefined);
}

function isChannel(channel: string): channel is NotificationChannel {
  return (CHANNELS as readonly string[]).includes(channel);
}

/**
 * One dedicated LISTEN connection per process, outside the query pool. It reconnects with
 * capped backoff and tells every subscriber when it has.
 */
export async function createNotificationListener({
  databaseUrl,
  logger,
}: {
  databaseUrl: string;
  logger: Logger;
}): Promise<NotificationListener> {
  const subscribers = new Map<NotificationChannel, Set<ChannelSubscriber>>(
    CHANNELS.map((channel) => [channel, new Set()]),
  );
  let client: Client | undefined;
  let closed = false;
  let reconnectTimer: NodeJS.Timeout | undefined;

  function deliver(message: Notification): void {
    if (!isChannel(message.channel) || message.payload === undefined) return;
    for (const subscriber of subscribers.get(message.channel) ?? []) {
      subscriber.onNotify(message.payload);
    }
  }

  async function connect(): Promise<void> {
    const next = new Client({ connectionString: databaseUrl, application_name: APPLICATION_NAME });
    next.on('notification', deliver);
    next.on('error', (error) => {
      logger.warn({ err: error }, 'Notification listener connection failed');
      lost(next);
    });
    next.on('end', () => lost(next));
    try {
      await next.connect();
      for (const channel of CHANNELS) await next.query(`LISTEN ${channel}`);
    } catch (error) {
      await release(next);
      throw error;
    }
    if (closed) {
      await release(next);
      return;
    }
    client = next;
  }

  function lost(failed: Client): void {
    if (closed || client !== failed) return;
    client = undefined;
    void release(failed);
    scheduleReconnect(FIRST_RECONNECT_DELAY_MS);
  }

  function scheduleReconnect(delayMs: number): void {
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect().then(
        () => {
          if (closed) return;
          logger.info('Notification listener reconnected');
          for (const set of subscribers.values()) {
            for (const subscriber of set) subscriber.onReconnect();
          }
        },
        (error: unknown) => {
          if (closed) return;
          logger.warn({ err: error, delayMs }, 'Notification listener reconnect failed');
          scheduleReconnect(Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS));
        },
      );
    }, delayMs);
  }

  await connect();

  return {
    subscribe(channel, subscriber) {
      const set = subscribers.get(channel);
      if (set === undefined) throw new Error(`Unknown notification channel ${channel}`);
      set.add(subscriber);
      return () => set.delete(subscriber);
    },
    async close() {
      closed = true;
      clearTimeout(reconnectTimer);
      const current = client;
      client = undefined;
      if (current !== undefined) await release(current);
    },
  };
}
