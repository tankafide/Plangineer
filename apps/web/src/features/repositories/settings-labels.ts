import type {
  AgentRole,
  ReviewRounds,
  ReviewSettings,
  WorkflowSettings,
} from '@plangineer/contracts';

export const ROLE_LABELS: Record<AgentRole, string> = {
  pre_planning: 'Pre-planning',
  planning: 'Planning',
  plan_review: 'Plan review',
  implementation: 'Implementation',
  implementation_review: 'Implementation review',
  verification: 'Verification',
};

/** Every role runs on Claude Code on the engineer's own runner and login, for now. */
export const ROLE_RUNTIME = 'Claude Code · local runner · your own login';

export const PLAN_CHECK_IN_LABELS: Record<WorkflowSettings['planCheckIn'], string> = {
  pause: 'Pause for my confirmation',
  skip: 'Skip',
};

export const FINDINGS_LABELS: Record<ReviewSettings['findings'], string> = {
  ask: 'Ask me',
  fix_all: 'Fix all',
};

export const ROUNDS_LABELS: Record<ReviewRounds['mode'], string> = {
  ask: 'Ask me',
  fixed: 'Fixed',
  adaptive: 'Adaptive',
};

export const REVIEWS = [
  { key: 'planReview', title: 'Plan review' },
  { key: 'implementationReview', title: 'Implementation review' },
] as const;
