import { describe, expect, it } from 'vitest';
import { listProcesses, trackSessionProcesses, updateTracked } from './session-processes.mjs';

const SINCE = 1_000_000;
const NOW = SINCE + 60_000;
const row = (pid, ppid, started = SINCE + pid, name = 'node') => ({ pid, ppid, started, name });
const entry = (started, goneAt) => ({ started, goneAt });
const trackedPids = (tracked) => [...tracked.keys()].toSorted((a, b) => a - b);

describe('updateTracked', () => {
  it('adds every process below a tracked one, however deep', () => {
    const tracked = new Map([[10, entry(SINCE)]]);
    const table = [row(10, 1, SINCE), row(13, 12), row(12, 11), row(11, 10)];
    updateTracked(tracked, table, { since: SINCE, now: NOW });

    expect(trackedPids(tracked)).toEqual([10, 11, 12, 13]);
  });

  it('keeps an orphan that started before its tracked parent exited', () => {
    const tracked = new Map([[11, entry(SINCE + 11)]]);
    updateTracked(tracked, [row(12, 11)], { since: SINCE, now: NOW });

    expect(tracked.has(12)).toBe(true);
    expect(tracked.get(11).goneAt).toBe(NOW);
  });

  it('drops a tracked pid that a newer process now holds, and ignores its children', () => {
    const tracked = new Map([[11, entry(SINCE + 11)]]);
    const table = [row(11, 1, SINCE + 500), row(12, 11, SINCE + 600)];
    updateTracked(tracked, table, { since: SINCE, now: NOW });

    expect(trackedPids(tracked)).toEqual([]);
  });

  it('ignores a child that started after its tracked parent was seen gone', () => {
    const tracked = new Map([[11, entry(SINCE + 11, SINCE + 20_000)]]);
    updateTracked(tracked, [row(12, 11, SINCE + 30_000)], { since: SINCE, now: NOW });

    expect(tracked.has(12)).toBe(false);
  });

  it('ignores a process that started before the session', () => {
    const tracked = new Map([[10, entry(undefined, SINCE)]]);
    updateTracked(tracked, [row(11, 10, SINCE - 5_000)], { since: SINCE, now: NOW });

    expect(tracked.has(11)).toBe(false);
  });

  it('leaves Docker and everything it starts running', () => {
    const tracked = new Map([[10, entry(SINCE)]]);
    const table = [row(10, 1, SINCE), row(11, 10, SINCE + 1, 'Docker Desktop.exe'), row(12, 11)];
    updateTracked(tracked, table, { since: SINCE, now: NOW });

    expect(trackedPids(tracked)).toEqual([10]);
  });
});

describe('trackSessionProcesses', () => {
  it('reports a failed read and keeps tracking', async () => {
    let reads = 0;
    const list = async () => {
      reads += 1;
      if (reads === 1) throw new Error('CIM is busy');
      return [];
    };
    const processes = trackSessionProcesses(4_000_000, { pollMs: 10, listProcesses: list });

    await expect.poll(() => reads).toBeGreaterThan(1);
    expect(await processes.stop()).toEqual({
      stopped: [],
      failures: ['Could not read the process table: CIM is busy'],
    });
  });
});

describe('listProcesses', () => {
  it('lists this process with its parent and a start time', async () => {
    const self = (await listProcesses()).find((process_) => process_.pid === process.pid);

    expect(self).toMatchObject({ ppid: process.ppid });
    expect(self.started).toBeLessThanOrEqual(Date.now());
    expect(self.name).toMatch(/node/i);
  });
});
