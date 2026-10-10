import {
  type PlanBody,
  type PlanQuestion,
  PlanSection,
  type PlanWorkspace,
  ReadinessKey,
  type ReadinessItem,
} from '@plangineer/contracts';

/** The questions the engineer has not answered yet. */
export const openQuestions = (questions: readonly PlanQuestion[]): PlanQuestion[] =>
  questions.filter((question) => question.answeredAt === null);

type BodyKey = Exclude<ReadinessKey, 'open_questions'>;

function bodyCount(key: BodyKey, body: PlanBody): number {
  switch (key) {
    case 'step_files':
      return body.steps.filter((step) => step.files.length === 0).length;
    case 'done_when':
      return body.steps.filter((step) => step.doneWhen.length === 0).length;
    case 'coverage':
      return body.coverage.filter((row) => row.ticks.length === 0).length;
    case 'stale_rows':
      return body.coverage.filter((row) => row.stale).length;
    case 'blockers':
      return body.blockers.length;
    default: {
      const unhandled: never = key;
      throw new Error(`Unhandled readiness key: ${String(unhandled)}`);
    }
  }
}

const counted = (key: ReadinessKey, count: number): ReadinessItem => ({
  key,
  ok: count === 0,
  count,
});

/**
 * The readiness checklist, one item per key. With no body yet, every item but the open
 * questions fails, since there is nothing to check.
 */
export function planReadiness(body: PlanBody | null, openCount: number): ReadinessItem[] {
  return ReadinessKey.options.map((key) => {
    if (key === 'open_questions') return counted(key, openCount);
    if (body === null) return { key, ok: false, count: 0 };
    return counted(key, bodyCount(key, body));
  });
}

export function isReady(items: ReadinessItem[]): boolean {
  return items.every((item) => item.ok);
}

/** The sections a failing readiness item asks the engineer to work on. */
function sectionsOf(key: ReadinessKey, body: PlanBody | null): PlanSection[] {
  switch (key) {
    case 'open_questions':
      return [];
    case 'step_files':
    case 'done_when':
      return ['steps'];
    case 'coverage':
    case 'stale_rows':
      return ['test_plan'];
    case 'blockers':
      return body === null ? [] : body.blockers.map((blocker) => blocker.section);
    default: {
      const unhandled: never = key;
      throw new Error(`Unhandled readiness key: ${String(unhandled)}`);
    }
  }
}

/**
 * Each section's status for the rail, in plan order. Constraints show only when the plan has
 * some, since the section is optional.
 */
export function sectionStatuses(
  body: PlanBody | null,
  openQuestionSections: PlanSection[],
  items: ReadinessItem[],
): PlanWorkspace['sections'] {
  const asked = new Set(openQuestionSections);
  const needsWork = new Set(
    items.filter((item) => !item.ok).flatMap((item) => sectionsOf(item.key, body)),
  );
  const hasConstraints = body !== null && body.constraints.length > 0;
  return PlanSection.options
    .filter((section) => section !== 'constraints' || hasConstraints)
    .map((section) => {
      if (asked.has(section)) return { section, status: 'open_question' };
      if (needsWork.has(section)) return { section, status: 'needs_work' };
      return { section, status: 'complete' };
    });
}
