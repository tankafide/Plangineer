import type { AgentRole } from '@plangineer/contracts';

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
