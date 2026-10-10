import type {
  DraftDecision,
  DraftStep,
  PlanBlocker,
  PlanBody,
  PlanConstraint,
  PlanDecision,
  PlanDraft,
  PlanStep,
  Prerequisite,
  CoverageRow,
  SectionPatch,
} from '@plangineer/contracts';

/** The feature's repository for every step, and a source of fresh uuids. */
export interface AdoptContext {
  repositoryId: string;
  newId: () => string;
}

type ItemKind = 'prerequisite' | 'step' | 'doneWhen' | 'decision' | 'constraint' | 'blocker';

type Adopter = ReturnType<typeof adopter>;

function baseIds(base: PlanBody | null): Record<ItemKind, Set<string>> {
  const ids = (items: (body: PlanBody) => { id: string }[]) =>
    new Set(base === null ? [] : items(base).map((item) => item.id));
  return {
    prerequisite: ids((body) => body.prerequisites),
    step: ids((body) => body.steps),
    doneWhen: ids((body) => body.steps.flatMap((step) => step.doneWhen)),
    decision: ids((body) => body.decisions),
    constraint: ids((body) => body.constraints),
    blocker: ids((body) => body.blockers),
  };
}

/**
 * Maps draft ids to stored ids. A draft id that names an item of the same kind in the base is
 * kept, and every other id gets one fresh id, so a reference follows the item it names.
 */
function adopter(base: PlanBody | null, ctx: AdoptContext) {
  const kept = baseIds(base);
  const adopted = new Map<string, string>();
  const fresh = (draftId: string) => {
    const id = adopted.get(draftId) ?? ctx.newId();
    adopted.set(draftId, id);
    return id;
  };
  return {
    item(kind: ItemKind, draftId: string): string {
      return kept[kind].has(draftId) ? draftId : fresh(draftId);
    },
    /** Call after the items it may name, so it finds their adopted ids first. */
    reference(kinds: ItemKind[], draftId: string): string {
      const id = adopted.get(draftId);
      if (id !== undefined) return id;
      return kinds.some((kind) => kept[kind].has(draftId)) ? draftId : fresh(draftId);
    },
  };
}

const adoptPrerequisites = (items: PlanDraft['prerequisites'], ids: Adopter): Prerequisite[] =>
  items.map((item) => ({ ...item, id: ids.item('prerequisite', item.id) }));

function adoptStep(step: DraftStep, id: string, ids: Adopter, ctx: AdoptContext): PlanStep {
  return {
    id,
    repositoryId: ctx.repositoryId,
    title: step.title,
    files: step.files,
    body: step.body,
    doneWhen: step.doneWhen.map((line) => ({ ...line, id: ids.item('doneWhen', line.id) })),
  };
}

const adoptSteps = (steps: DraftStep[], ids: Adopter, ctx: AdoptContext): PlanStep[] =>
  steps.map((step) => adoptStep(step, ids.item('step', step.id), ids, ctx));

const adoptDecisions = (items: DraftDecision[], ids: Adopter): PlanDecision[] =>
  items.map((item) => ({ ...item, id: ids.item('decision', item.id) }));

const adoptConstraints = (items: PlanDraft['constraints'], ids: Adopter): PlanConstraint[] =>
  items.map((item) => ({ ...item, id: ids.item('constraint', item.id) }));

const adoptCoverage = (rows: PlanDraft['coverage'], ids: Adopter): CoverageRow[] =>
  rows.map((row) => ({
    lineId: ids.reference(['doneWhen', 'constraint'], row.lineId),
    ticks: row.ticks,
    stale: false,
  }));

const adoptBlockers = (items: PlanDraft['blockers'], ids: Adopter): PlanBlocker[] =>
  items.map((item) => ({
    ...item,
    id: ids.item('blocker', item.id),
    stepId: item.stepId === null ? null : ids.reference(['step'], item.stepId),
  }));

/** A whole draft as a stored body, with ids adopted against the latest body (D3). */
export function adoptDraft(draft: PlanDraft, base: PlanBody | null, ctx: AdoptContext): PlanBody {
  const ids = adopter(base, ctx);
  const prerequisites = adoptPrerequisites(draft.prerequisites, ids);
  const steps = adoptSteps(draft.steps, ids, ctx);
  const decisions = adoptDecisions(draft.decisions, ids);
  const constraints = adoptConstraints(draft.constraints, ids);
  return {
    goal: draft.goal,
    prerequisites,
    steps,
    decisions,
    constraints,
    coverage: adoptCoverage(draft.coverage, ids),
    blockers: adoptBlockers(draft.blockers, ids),
    verification: draft.verification,
  };
}

/** The base with one section replaced by the adopted patch. */
export function mergeSection(base: PlanBody, patch: SectionPatch, ctx: AdoptContext): PlanBody {
  const ids = adopter(base, ctx);
  switch (patch.section) {
    case 'goal':
      return { ...base, goal: patch.goal };
    case 'prerequisites':
      return { ...base, prerequisites: adoptPrerequisites(patch.prerequisites, ids) };
    case 'steps': {
      const steps = adoptSteps(patch.steps, ids, ctx);
      const stepIds = new Set(steps.map((step) => step.id));
      const blockers = base.blockers.filter(
        (blocker) => blocker.stepId === null || stepIds.has(blocker.stepId),
      );
      return { ...base, steps, blockers };
    }
    case 'decisions':
      return { ...base, decisions: adoptDecisions(patch.decisions, ids) };
    case 'constraints':
      return { ...base, constraints: adoptConstraints(patch.constraints, ids) };
    case 'test_plan':
      return { ...base, coverage: adoptCoverage(patch.coverage, ids) };
    case 'verification':
      return { ...base, verification: patch.verification };
    default: {
      const unhandled: never = patch;
      throw new Error(`Unhandled section patch: ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The base with one step rewritten in place. The step keeps its id. */
export function replaceStep(
  base: PlanBody,
  stepId: string,
  step: DraftStep,
  ctx: AdoptContext,
): PlanBody {
  const index = base.steps.findIndex((candidate) => candidate.id === stepId);
  if (index === -1) throw new Error(`Step ${stepId} is not in the plan`);
  const replaced = adoptStep(step, stepId, adopter(base, ctx), ctx);
  return { ...base, steps: base.steps.with(index, replaced) };
}
