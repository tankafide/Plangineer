import type {
  CoverageColumn,
  PlanConflictReason,
  PlanningTurnKind,
  PlanRevisionSource,
  PlanSection,
  ReadinessItem,
  ReadinessKey,
  SectionAction,
  SectionStatus,
} from '@plangineer/contracts';

/** Why the API refused a plan write, in the engineer's words. */
export const PLAN_CONFLICT_MESSAGES: Record<PlanConflictReason, string> = {
  not_planning: 'The feature is not in planning any more.',
  turn_running: 'The agent is still working on this plan.',
  questions_open: 'Answer the open questions first.',
  stale_revision: 'The plan changed since you opened it. Reload to see the newest revision.',
  not_ready: 'The plan is not ready yet. Clear the checklist first.',
  answered: 'This question has already been answered.',
  question_closed: 'This question was closed by a newer revision.',
  nothing_to_retry: 'There is no failed turn to retry.',
};

export const SECTION_LABELS: Record<PlanSection, string> = {
  goal: 'Goal',
  prerequisites: 'Prerequisites',
  steps: 'Steps',
  decisions: 'Decisions',
  constraints: 'Constraints',
  test_plan: 'Test plan',
  verification: 'Verification',
};

export const SECTION_ACTION_LABELS: Record<SectionAction, string> = {
  expand: 'Expand',
  simplify: 'Simplify',
  regenerate: 'Regenerate',
};

// Open question and needs work both wait on the engineer.
export const SECTION_STATUS_BADGES: Record<
  SectionStatus,
  { label: string; variant: 'success' | 'warning' }
> = {
  complete: { label: 'Complete', variant: 'success' },
  open_question: { label: 'Open question', variant: 'warning' },
  needs_work: { label: 'Needs work', variant: 'warning' },
};

export const TURN_KIND_LABELS: Record<PlanningTurnKind, string> = {
  guided: 'Drafting the plan',
  section_action: 'Rewriting a section',
  revise_step: 'Revising a step',
};

export const COVERAGE_COLUMN_LABELS: Record<CoverageColumn, string> = {
  unit: 'Unit',
  integration: 'Integration',
  component: 'Component',
  end_to_end: 'End to end',
  agent_check: 'Agent check',
  human_check: 'Human check',
};

export const REVISION_SOURCE_LABELS: Record<PlanRevisionSource, string> = {
  agent: 'Agent',
  engineer: 'Engineer',
};

/** Each readiness item as the line it reads when it passes, and as a count when it fails. */
const READINESS_LABELS: Record<ReadinessKey, { ok: string; failing: (count: number) => string }> = {
  open_questions: {
    ok: 'No open question',
    failing: (count) => (count === 1 ? '1 open question' : `${count} open questions`),
  },
  step_files: {
    ok: 'No step without files',
    failing: (count) => (count === 1 ? '1 step without files' : `${count} steps without files`),
  },
  done_when: {
    ok: 'No step without done-when lines',
    failing: (count) =>
      count === 1 ? '1 step without done-when lines' : `${count} steps without done-when lines`,
  },
  coverage: {
    ok: 'No test row without a tick',
    failing: (count) =>
      count === 1 ? '1 test row without a tick' : `${count} test rows without a tick`,
  },
  stale_rows: {
    ok: 'No stale test row',
    failing: (count) => (count === 1 ? '1 stale test row' : `${count} stale test rows`),
  },
  blockers: {
    ok: 'No blocker',
    failing: (count) => (count === 1 ? '1 blocker' : `${count} blockers`),
  },
};

export function readinessLabel(item: ReadinessItem): string {
  const labels = READINESS_LABELS[item.key];
  return item.ok ? labels.ok : labels.failing(item.count);
}
