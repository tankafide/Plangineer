import type { RunEventBody, RunStatus } from '@plangineer/contracts';

export type NextRunStatus = { ok: true; status: RunStatus } | { ok: false };

const reject: NextRunStatus = { ok: false };
const to = (status: RunStatus): NextRunStatus => ({ ok: true, status });

/** Whether an event may be appended to a run in this status, and the status it leaves. */
export function nextRunStatus(current: RunStatus, event: RunEventBody): NextRunStatus {
  switch (event.type) {
    case 'run.queued':
      return current === 'queued' ? to('queued') : reject;
    case 'run.leased':
      return current === 'queued' ? to('leased') : reject;
    case 'run.started':
      return current === 'leased' ? to('running') : reject;
    case 'run.cancel_requested':
      return current === 'queued' || current === 'leased' || current === 'running'
        ? to(current)
        : reject;
    case 'run.lease_lost':
      if (event.requeued) return current === 'leased' ? to('queued') : reject;
      return current === 'leased' || current === 'running' ? to(current) : reject;
    case 'agent.session':
    case 'agent.message':
    case 'agent.tool_use':
    case 'agent.tool_result':
    case 'agent.rate_limit':
    case 'agent.other':
      return current === 'running' ? to('running') : reject;
    case 'run.succeeded':
      return current === 'running' ? to('succeeded') : reject;
    case 'run.failed':
      return current === 'leased' || current === 'running' ? to('failed') : reject;
    case 'run.cancelled':
      return current === 'queued' || current === 'leased' || current === 'running'
        ? to('cancelled')
        : reject;
    default: {
      const unhandled: never = event;
      throw new Error(`Unhandled run event: ${JSON.stringify(unhandled)}`);
    }
  }
}

export interface LeaseLostInput {
  status: 'leased' | 'running';
  attempt: number;
  maxAttempts: number;
  cancelRequested: boolean;
}

export interface LeaseLostOutcome {
  status: RunStatus;
  requeued: boolean;
  event: 'run.failed' | 'run.cancelled' | null;
}

/**
 * What a lapsed lease does to a run. Only a run that never started is retried, since a
 * started agent may already have acted.
 */
export function leaseLostOutcome({
  status,
  attempt,
  maxAttempts,
  cancelRequested,
}: LeaseLostInput): LeaseLostOutcome {
  if (cancelRequested) return { status: 'cancelled', requeued: false, event: 'run.cancelled' };
  if (status === 'leased' && attempt < maxAttempts) {
    return { status: 'queued', requeued: true, event: null };
  }
  return { status: 'failed', requeued: false, event: 'run.failed' };
}
