import type { Run, RunEvent } from '@plangineer/contracts';

/**
 * The cached run after a lifecycle event, so the details stay current without a refetch. Each
 * move is guarded by the status and attempt it starts from, so replaying the backlog onto a run
 * fetched later never moves it backwards.
 */
export function patchRunWithEvent(run: Run, event: RunEvent): Run {
  switch (event.type) {
    case 'run.leased':
      return run.status === 'queued' && event.attempt > run.attempt
        ? { ...run, status: 'leased', attempt: event.attempt }
        : run;
    case 'run.started':
      return run.status === 'leased'
        ? { ...run, status: 'running', commit: event.commit, startedAt: event.at }
        : run;
    case 'run.cancel_requested':
      return { ...run, cancelRequested: true };
    case 'run.lease_lost':
      return event.requeued && run.status === 'leased' && event.attempt === run.attempt
        ? { ...run, status: 'queued' }
        : run;
    default:
      return run;
  }
}
