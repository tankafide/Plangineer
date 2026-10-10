import {
  type FeatureState,
  type RunMode,
  type RunStatus,
  TERMINAL_RUN_STATUSES,
} from '@plangineer/contracts';

const isTerminal = (status: RunStatus) =>
  (TERMINAL_RUN_STATUSES as readonly RunStatus[]).includes(status);

/**
 * A pre-planning feature is plan ready once every task's run has ended. A failed or cancelled
 * task counts as finished, so one bad task never holds the feature back.
 */
export function featureStateAfterTasks(state: FeatureState, statuses: RunStatus[]): FeatureState {
  if (state === 'pre_planning' && statuses.every(isTerminal)) return 'plan_ready';
  return state;
}

type StartPlanning =
  | { ok: true; state: 'planning' }
  | { ok: false; reason: 'auto_loop' | 'already_planning' };

/** Whether the engineer may start planning. Under Auto loop, planning starts by itself. */
export function startPlanning(state: FeatureState, runMode: RunMode): StartPlanning {
  if (planOpen(state)) return { ok: false, reason: 'already_planning' };
  if (runMode === 'auto_loop') return { ok: false, reason: 'auto_loop' };
  return { ok: true, state: 'planning' };
}

/** Whether the feature has a plan workspace the engineer can open and work in. */
export function planOpen(state: FeatureState): boolean {
  switch (state) {
    case 'planning':
    case 'ready_for_review':
      return true;
    case 'pre_planning':
    case 'plan_ready':
      return false;
    default: {
      const unhandled: never = state;
      throw new Error(`Unhandled feature state: ${String(unhandled)}`);
    }
  }
}
