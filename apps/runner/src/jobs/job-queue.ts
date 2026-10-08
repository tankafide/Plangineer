/** How long a plan limit with no reset time pauses the queue. The API assumes the same. */
const DEFAULT_PLAN_LIMIT_PAUSE_MS = 15 * 60 * 1000;
/** The longest delay `setTimeout` accepts. Longer pauses wait in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface QueuedJob {
  readonly isFinished: boolean;
  run(): Promise<void>;
}

export interface JobQueueOptions {
  concurrency: number;
  /** Reports the plan limit's reset time, or null once the pause has ended. */
  reportPlanLimit(resetsAt: string | null): void;
  /** Receives a job that failed unexpectedly, after it has sent its terminal event. */
  onJobError(error: unknown): void;
}

export interface JobQueue {
  /** The reset time of the plan limit pausing the queue, or null when it is not paused. */
  readonly planLimitResetsAt: string | null;
  add(job: QueuedJob): void;
  /** Starts no new job until `resetsAt`, or for 15 minutes when it is null. */
  pause(resetsAt: string | null): void;
  /** Resolves once no job is running. */
  whenIdle(): Promise<void>;
  close(): void;
}

/** Holds assigned jobs in memory and runs up to the concurrency limit of them at once. */
export function createJobQueue(options: JobQueueOptions): JobQueue {
  const pending: QueuedJob[] = [];
  const idleWaiters: (() => void)[] = [];
  let running = 0;
  let pausedUntil: number | null = null;
  let timer: NodeJS.Timeout | undefined;

  function settle(): void {
    running -= 1;
    if (running === 0) for (const resolve of idleWaiters.splice(0)) resolve();
    pump();
  }

  const canStart = () => pausedUntil === null && running < options.concurrency;

  function pump(): void {
    while (canStart()) {
      const job = pending.shift();
      if (job === undefined) return;
      if (job.isFinished) continue;
      running += 1;
      job
        .run()
        .catch((error: unknown) => options.onJobError(error))
        .finally(settle);
    }
  }

  function wait(): void {
    if (pausedUntil === null) return;
    const remaining = pausedUntil - Date.now();
    if (remaining > 0) {
      timer = setTimeout(wait, Math.min(remaining, MAX_TIMER_MS));
      return;
    }
    pausedUntil = null;
    timer = undefined;
    options.reportPlanLimit(null);
    pump();
  }

  return {
    get planLimitResetsAt() {
      return pausedUntil === null ? null : new Date(pausedUntil).toISOString();
    },
    add(job) {
      pending.push(job);
      pump();
    },
    pause(resetsAt) {
      const until =
        resetsAt === null ? Date.now() + DEFAULT_PLAN_LIMIT_PAUSE_MS : Date.parse(resetsAt);
      if (until <= Date.now() || (pausedUntil !== null && until <= pausedUntil)) return;
      pausedUntil = until;
      clearTimeout(timer);
      options.reportPlanLimit(new Date(until).toISOString());
      wait();
    },
    whenIdle() {
      if (running === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
    close() {
      clearTimeout(timer);
    },
  };
}
