import type { SetupStatus } from '@plangineer/contracts';

export type SetupEvent =
  | 'scanned'
  | 'started'
  | 'pr_opened'
  | 'generation_failed'
  | 'pr_merged'
  | 'pr_closed';

export type NextSetupStatus =
  | { ok: true; status: SetupStatus }
  | { ok: false; reason: 'invalid_transition' };

const TRANSITIONS: Record<SetupEvent, { from: readonly (SetupStatus | null)[]; to: SetupStatus }> =
  {
    scanned: { from: [null, 'scanned', 'pr_open', 'complete', 'failed'], to: 'scanned' },
    started: { from: ['scanned', 'failed'], to: 'generating' },
    pr_opened: { from: ['generating'], to: 'pr_open' },
    generation_failed: { from: ['generating'], to: 'failed' },
    pr_merged: { from: ['pr_open'], to: 'complete' },
    pr_closed: { from: ['pr_open'], to: 'failed' },
  };

/** The status a setup moves to on an event, or a rejection when the event cannot happen now. */
export function nextSetupStatus(current: SetupStatus | null, event: SetupEvent): NextSetupStatus {
  const transition = TRANSITIONS[event];
  return transition.from.includes(current)
    ? { ok: true, status: transition.to }
    : { ok: false, reason: 'invalid_transition' };
}
