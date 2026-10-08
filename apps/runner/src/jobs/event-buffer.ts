import {
  MAX_EVENTS_MESSAGE_BYTES,
  MAX_EVENTS_PER_MESSAGE,
  type RunnerRunEventBody,
  type RunnerToServerMessage,
} from '@plangineer/contracts';

/** The most events one run may hold that the server has not acknowledged. */
export const MAX_UNACKED_EVENTS = 10_000;

type RunEventsMessage = Extract<RunnerToServerMessage, { type: 'run.events' }>;

interface Entry {
  seq: number;
  event: RunnerRunEventBody;
  /** The entry's serialized size plus the comma that separates it from the next. */
  bytes: number;
}

/**
 * One run attempt's events until the server acknowledges them. Each event gets the next runner
 * sequence. Batches go out in sequence order, and after a reconnect everything above the
 * acknowledged sequence goes out again.
 */
export interface EventBuffer {
  readonly isFull: boolean;
  readonly isDrained: boolean;
  /** Whether a whole batch is waiting, so it should go out before the next timed flush. */
  readonly hasFullBatch: boolean;
  append(event: RunnerRunEventBody): void;
  acknowledge(seq: number): void;
  /** Marks everything above `ackedSeq` unsent, for a new connection. */
  resendAbove(ackedSeq: number): void;
  /** The next batch of unsent events, at most 100 events and 512 KiB, or null when none. */
  nextBatch(): RunEventsMessage | null;
}

export function createEventBuffer(runId: string, attempt: number): EventBuffer {
  // The empty events array stands in for the separator the last entry does not need.
  const envelopeBytes =
    Buffer.byteLength(JSON.stringify({ type: 'run.events', runId, attempt, events: [] })) - 1;
  let entries: Entry[] = [];
  let nextSeq = 1;
  let sentSeq = 0;
  let unsentCount = 0;
  let unsentBytes = 0;

  function markSent(seq: number): void {
    sentSeq = seq;
    const unsent = entries.filter((entry) => entry.seq > sentSeq);
    unsentCount = unsent.length;
    unsentBytes = unsent.reduce((total, entry) => total + entry.bytes, 0);
  }

  return {
    get isFull() {
      return entries.length >= MAX_UNACKED_EVENTS;
    },
    get isDrained() {
      return entries.length === 0;
    },
    get hasFullBatch() {
      return (
        unsentCount >= MAX_EVENTS_PER_MESSAGE ||
        envelopeBytes + unsentBytes > MAX_EVENTS_MESSAGE_BYTES
      );
    },
    append(event) {
      const seq = nextSeq;
      nextSeq += 1;
      const bytes = Buffer.byteLength(JSON.stringify({ seq, event })) + 1;
      entries.push({ seq, event, bytes });
      unsentCount += 1;
      unsentBytes += bytes;
    },
    acknowledge(seq) {
      entries = entries.filter((entry) => entry.seq > seq);
      if (seq > sentSeq) markSent(seq);
    },
    resendAbove(ackedSeq) {
      entries = entries.filter((entry) => entry.seq > ackedSeq);
      markSent(ackedSeq);
    },
    nextBatch() {
      const batch: Entry[] = [];
      let bytes = envelopeBytes;
      for (const entry of entries) {
        if (entry.seq <= sentSeq) continue;
        if (batch.length === MAX_EVENTS_PER_MESSAGE) break;
        if (bytes + entry.bytes > MAX_EVENTS_MESSAGE_BYTES) break;
        batch.push(entry);
        bytes += entry.bytes;
      }
      const last = batch.at(-1);
      if (last === undefined) {
        if (unsentCount > 0) throw new Error(`An event of run ${runId} does not fit one message`);
        return null;
      }
      markSent(last.seq);
      const events = batch.map(({ seq, event }) => ({ seq, event }));
      return { type: 'run.events', runId, attempt, events };
    },
  };
}
