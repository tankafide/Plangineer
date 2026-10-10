import type { ReviewSettings, RunMode, WorkflowSettings } from '@plangineer/contracts';

const ASK: ReviewSettings = { findings: 'ask', rounds: { mode: 'ask' } };
const FIX_TWO_ROUNDS: ReviewSettings = { findings: 'fix_all', rounds: { mode: 'fixed', count: 2 } };

const SETTINGS: Record<RunMode, WorkflowSettings> = {
  manual: { decisions: 'ask', planCheckIn: 'pause', planReview: ASK, implementationReview: ASK },
  manual_plan: {
    decisions: 'ask',
    planCheckIn: 'pause',
    planReview: ASK,
    implementationReview: FIX_TWO_ROUNDS,
  },
  auto_loop: {
    decisions: 'recommended',
    planCheckIn: 'skip',
    planReview: FIX_TWO_ROUNDS,
    implementationReview: FIX_TWO_ROUNDS,
  },
};

/** The stop points a run mode sets, from the MVP's run modes table. */
export function workflowSettingsFor(runMode: RunMode): WorkflowSettings {
  return SETTINGS[runMode];
}
