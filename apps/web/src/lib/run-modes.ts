import type { RunMode } from '@plangineer/contracts';

export const RUN_MODE_LABELS: Record<RunMode, string> = {
  manual: 'Manual',
  manual_plan: 'Manual plan',
  auto_loop: 'Auto loop',
};

/** What each run mode leaves to the engineer, one line each. */
export const RUN_MODE_HINTS: Record<RunMode, string> = {
  manual: 'You decide at every stop point.',
  manual_plan: 'You shape and approve the plan. Agents build and review the code.',
  auto_loop: 'Agents take the feature to an open pull request.',
};
