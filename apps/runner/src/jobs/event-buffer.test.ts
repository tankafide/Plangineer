import { randomUUID } from 'node:crypto';
import {
  MAX_EVENTS_MESSAGE_BYTES,
  RunnerToServerMessage,
  type RunnerRunEventBody,
} from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { createEventBuffer, type EventBuffer, MAX_UNACKED_EVENTS } from './event-buffer.ts';

function message(text: string): RunnerRunEventBody {
  return { type: 'agent.message', text, truncated: false, parentToolUseId: null };
}

function drain(buffer: EventBuffer) {
  const batches = [];
  for (let batch = buffer.nextBatch(); batch !== null; batch = buffer.nextBatch()) {
    batches.push(batch);
  }
  return batches;
}

const seqs = (batches: ReturnType<typeof drain>) =>
  batches.flatMap((batch) => batch.events.map((entry) => entry.seq));

describe('createEventBuffer', () => {
  it('numbers events from 1 and sends them in batches of at most 100', () => {
    const buffer = createEventBuffer(randomUUID(), 1);
    for (let index = 0; index < 250; index += 1) buffer.append(message(`event ${index}`));

    const batches = drain(buffer);

    expect(batches.map((batch) => batch.events.length)).toEqual([100, 100, 50]);
    expect(seqs(batches)).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
    for (const batch of batches) expect(RunnerToServerMessage.safeParse(batch).success).toBe(true);
  });

  it('fills each batch up to 512 KiB of serialized JSON and no further', () => {
    const buffer = createEventBuffer(randomUUID(), 2);
    for (let index = 0; index < 30; index += 1) buffer.append(message('x'.repeat(60_000)));

    const batches = drain(buffer);

    expect(batches.length).toBeGreaterThan(3);
    expect(seqs(batches)).toHaveLength(30);
    for (const batch of batches) {
      expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(
        MAX_EVENTS_MESSAGE_BYTES,
      );
    }
    const [first, second] = batches;
    const [nextEntry] = second?.events ?? [];
    if (first === undefined || nextEntry === undefined) throw new Error('expected two batches');
    const oneMore = { ...first, events: [...first.events, nextEntry] };
    expect(Buffer.byteLength(JSON.stringify(oneMore))).toBeGreaterThan(MAX_EVENTS_MESSAGE_BYTES);
  });

  it('reports a full batch once 100 events or 512 KiB are waiting', () => {
    const counted = createEventBuffer(randomUUID(), 1);
    for (let index = 0; index < 99; index += 1) counted.append(message('a'));
    expect(counted.hasFullBatch).toBe(false);
    counted.append(message('a'));
    expect(counted.hasFullBatch).toBe(true);

    const sized = createEventBuffer(randomUUID(), 1);
    for (let index = 0; index < 7; index += 1) sized.append(message('x'.repeat(65_536)));
    expect(sized.hasFullBatch).toBe(false);
    sized.append(message('x'.repeat(65_536)));
    expect(sized.hasFullBatch).toBe(true);
  });

  it('drops acknowledged events and resends only those above the acknowledgement', () => {
    const buffer = createEventBuffer(randomUUID(), 1);
    for (let index = 0; index < 5; index += 1) buffer.append(message(`event ${index}`));
    drain(buffer);
    buffer.acknowledge(2);

    buffer.resendAbove(3);

    expect(seqs(drain(buffer))).toEqual([4, 5]);
    buffer.acknowledge(5);
    expect(buffer.isDrained).toBe(true);
  });

  it('is full at 10,000 unacknowledged events', () => {
    const buffer = createEventBuffer(randomUUID(), 1);
    for (let index = 1; index < MAX_UNACKED_EVENTS; index += 1) buffer.append(message('a'));
    expect(buffer.isFull).toBe(false);

    buffer.append(message('a'));

    expect(buffer.isFull).toBe(true);
    buffer.acknowledge(1);
    expect(buffer.isFull).toBe(false);
  });
});
