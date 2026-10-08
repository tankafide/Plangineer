import type { RunEvent } from '@plangineer/contracts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { type NotificationListener, RUN_EVENTS_CHANNEL } from '../realtime/notifications.ts';
import { readRunEvents } from './run-events-repository.ts';
import { findLastEventId } from './run-repository.ts';

/** Rows read per query, both by the tail and by a stream's backlog. */
export const RUN_EVENTS_PAGE_SIZE = 500;

/** An open stream on one run, as the tail feeds it. */
interface TailStream {
  deliver: (events: RunEvent[]) => void;
  end: () => void;
}

export interface RunEventTail {
  /** Adds a stream to its run's fan-out. Resolves once the run's last id is known. */
  subscribe: (runId: string, stream: TailStream) => Promise<() => void>;
  /** Ends every open stream. */
  close: () => void;
}

interface TailedRun {
  lastEventId: number;
  streams: Set<TailStream>;
  /** Reads run one at a time per run, in the order notifications arrive. */
  reads: Promise<void>;
}

/**
 * The process's one tail of run_events. Memory holds only the last id read per run and its
 * open streams. A notification for a run reads its new rows once and fans them out to every
 * stream on it. After the listener reconnects, each open run is read once to catch up.
 */
export function createRunEventTail({
  deps,
  listener,
}: {
  deps: ServiceDeps;
  listener: NotificationListener;
}): RunEventTail {
  const { db, logger } = deps;
  const tailed = new Map<string, TailedRun>();

  async function readNew(runId: string, run: TailedRun): Promise<void> {
    let page: RunEvent[];
    do {
      page = await readRunEvents(db, runId, run.lastEventId, RUN_EVENTS_PAGE_SIZE);
      logger.debug({ runId, count: page.length }, 'Run events tail read');
      const last = page.at(-1);
      if (last === undefined) return;
      run.lastEventId = last.id;
      for (const stream of run.streams) stream.deliver(page);
    } while (page.length === RUN_EVENTS_PAGE_SIZE);
  }

  function enqueueRead(runId: string, run: TailedRun): void {
    run.reads = run.reads.then(() =>
      readNew(runId, run).catch((error: unknown) => {
        logger.error({ err: error, runId }, 'Run events tail read failed');
      }),
    );
  }

  const unsubscribe = listener.subscribe(RUN_EVENTS_CHANNEL, {
    onNotify: (runId) => {
      const run = tailed.get(runId);
      if (run !== undefined) enqueueRead(runId, run);
    },
    onReconnect: () => {
      for (const [runId, run] of tailed) enqueueRead(runId, run);
    },
  });

  return {
    async subscribe(runId, stream) {
      let run = tailed.get(runId);
      if (run === undefined) {
        const created: TailedRun = { lastEventId: 0, streams: new Set(), reads: Promise.resolve() };
        created.reads = findLastEventId(db, runId).then((lastEventId) => {
          created.lastEventId = lastEventId;
        });
        tailed.set(runId, created);
        run = created;
      }
      const subscribed = run;
      subscribed.streams.add(stream);
      try {
        await subscribed.reads;
      } catch (error) {
        if (tailed.get(runId) === subscribed) tailed.delete(runId);
        throw error;
      }
      return () => {
        subscribed.streams.delete(stream);
        if (subscribed.streams.size === 0 && tailed.get(runId) === subscribed) tailed.delete(runId);
      };
    },
    close() {
      unsubscribe();
      for (const run of tailed.values()) {
        for (const stream of run.streams) stream.end();
      }
      tailed.clear();
    },
  };
}
