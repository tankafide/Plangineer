import { describe, expect, it } from 'vitest';
import { addDescendants, listProcesses } from './session-processes.mjs';

const SINCE = 1_000_000;
const row = (pid, ppid, started = SINCE + pid, name = 'node') => ({ pid, ppid, started, name });

describe('addDescendants', () => {
  it('adds every process below a tracked one, however deep', () => {
    const tracked = new Map([[10, SINCE]]);
    addDescendants(tracked, [row(10, 1, SINCE), row(13, 12), row(12, 11), row(11, 10)], SINCE);

    expect([...tracked.keys()].toSorted((a, b) => a - b)).toEqual([10, 11, 12, 13]);
  });

  it('keeps an orphan whose tracked parent has exited', () => {
    const tracked = new Map([
      [10, SINCE],
      [11, SINCE + 11],
    ]);
    addDescendants(tracked, [row(12, 11)], SINCE);

    expect(tracked.has(12)).toBe(true);
  });

  it('ignores the children of a tracked pid that a newer process reuses', () => {
    const tracked = new Map([[11, SINCE + 11]]);
    addDescendants(tracked, [row(11, 1, SINCE + 500), row(12, 11, SINCE + 600)], SINCE);

    expect(tracked.has(12)).toBe(false);
  });

  it('ignores a process that started before the session', () => {
    const tracked = new Map([[10, undefined]]);
    addDescendants(tracked, [row(11, 10, SINCE - 5_000)], SINCE);

    expect(tracked.has(11)).toBe(false);
  });

  it('leaves Docker and everything it starts running', () => {
    const tracked = new Map([[10, SINCE]]);
    const table = [row(10, 1, SINCE), row(11, 10, SINCE + 1, 'Docker Desktop.exe'), row(12, 11)];
    addDescendants(tracked, table, SINCE);

    expect([...tracked.keys()]).toEqual([10]);
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
