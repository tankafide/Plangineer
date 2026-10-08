import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJobQueue, type QueuedJob } from './job-queue.ts';

/** A job that runs until the test ends it. */
function controlledJob() {
  let end: (() => void) | undefined;
  const job = {
    isFinished: false,
    started: false,
    run() {
      job.started = true;
      return new Promise<void>((resolve) => {
        end = resolve;
      });
    },
    end: () => end?.(),
  };
  return job satisfies QueuedJob;
}

function queue(concurrency: number) {
  const reports: (string | null)[] = [];
  const jobQueue = createJobQueue({
    concurrency,
    reportPlanLimit: (resetsAt) => reports.push(resetsAt),
    onJobError: (error) => {
      throw error;
    },
  });
  return { jobQueue, reports };
}

describe('createJobQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-07T12:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs up to the concurrency limit and starts the next job when one ends', async () => {
    const { jobQueue } = queue(1);
    const first = controlledJob();
    const second = controlledJob();

    jobQueue.add(first);
    jobQueue.add(second);

    expect([first.started, second.started]).toEqual([true, false]);
    first.end();
    await vi.waitFor(() => expect(second.started).toBe(true));
  });

  it('skips a job that finished while it waited', () => {
    const { jobQueue } = queue(1);
    const first = controlledJob();
    const stopped = controlledJob();
    stopped.isFinished = true;

    jobQueue.add(first);
    jobQueue.add(stopped);
    first.end();

    expect(stopped.started).toBe(false);
  });

  it('pauses for 15 minutes on a plan limit with no reset time, then reports null', async () => {
    const { jobQueue, reports } = queue(1);
    jobQueue.pause(null);
    const waiting = controlledJob();
    jobQueue.add(waiting);

    expect(reports).toEqual(['2026-10-07T12:15:00.000Z']);
    expect(jobQueue.planLimitResetsAt).toBe('2026-10-07T12:15:00.000Z');
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 - 1);
    expect(waiting.started).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(reports).toEqual(['2026-10-07T12:15:00.000Z', null]);
    expect(waiting.started).toBe(true);
    expect(jobQueue.planLimitResetsAt).toBeNull();
  });

  it('pauses until a reset time beyond the longest timer delay', async () => {
    const { jobQueue, reports } = queue(1);
    jobQueue.pause('2026-12-01T00:00:00.000Z');
    const waiting = controlledJob();
    jobQueue.add(waiting);

    await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000);
    expect(waiting.started).toBe(false);
    await vi.advanceTimersByTimeAsync(25 * 24 * 60 * 60 * 1000);

    expect(waiting.started).toBe(true);
    expect(reports).toEqual(['2026-12-01T00:00:00.000Z', null]);
  });

  it('ignores a reset time already passed', () => {
    const { jobQueue, reports } = queue(1);

    jobQueue.pause('2026-10-07T11:00:00.000Z');

    expect(reports).toEqual([]);
    expect(jobQueue.planLimitResetsAt).toBeNull();
  });

  it('resolves whenIdle once the running jobs end', async () => {
    const { jobQueue } = queue(2);
    const job = controlledJob();
    jobQueue.add(job);
    let idle = false;
    void jobQueue.whenIdle().then(() => {
      idle = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(idle).toBe(false);
    job.end();

    await vi.waitFor(() => expect(idle).toBe(true));
  });
});
