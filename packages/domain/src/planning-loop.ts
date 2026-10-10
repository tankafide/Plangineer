import type {
  Decisions,
  PlanCheckIn,
  PlanningOutput,
  PlanningTurnKind,
  PlanSection,
} from '@plangineer/contracts';

/** Auto loop stops after this many guided drafts in a row that are not ready (D6). */
export const AUTO_DRAFTS_MAX = 3;

interface TurnShape {
  kind: PlanningTurnKind;
  section: PlanSection | null;
}

/** Whether a run's output is one its turn may write. Questions are only for the `ask` setting. */
export function outputFits(turn: TurnShape, output: PlanningOutput, decisions: Decisions): boolean {
  switch (turn.kind) {
    case 'guided':
      return output.kind === 'plan' || (output.kind === 'questions' && decisions === 'ask');
    case 'section_action':
      return output.kind === 'section' && output.patch.section === turn.section;
    case 'revise_step':
      return output.kind === 'step';
    default: {
      const unhandled: never = turn.kind;
      throw new Error(`Unhandled planning turn kind: ${String(unhandled)}`);
    }
  }
}

interface TurnResult {
  turnKind: PlanningTurnKind;
  outputKind: PlanningOutput['kind'];
  planCheckIn: PlanCheckIn;
  ready: boolean;
  uncleanDrafts: number;
}

type NextStep = 'wait' | 'queue_guided' | 'mark_ready' | 'stop';

function afterGuidedDraft(result: TurnResult): NextStep {
  switch (result.planCheckIn) {
    case 'pause':
      return 'wait';
    case 'skip':
      if (result.ready) return 'mark_ready';
      return result.uncleanDrafts < AUTO_DRAFTS_MAX ? 'queue_guided' : 'stop';
    default: {
      const unhandled: never = result.planCheckIn;
      throw new Error(`Unhandled plan check-in: ${String(unhandled)}`);
    }
  }
}

/**
 * What follows an applied planning turn. Questions, section actions and step revisions wait for
 * the engineer. A guided draft under `skip` is marked ready, redrafted or stopped (D6).
 */
export function afterPlanningTurn(result: TurnResult): NextStep {
  if (result.outputKind === 'questions') return 'wait';
  switch (result.turnKind) {
    case 'guided':
      return afterGuidedDraft(result);
    case 'section_action':
    case 'revise_step':
      return 'wait';
    default: {
      const unhandled: never = result.turnKind;
      throw new Error(`Unhandled planning turn kind: ${String(unhandled)}`);
    }
  }
}

/**
 * How many of the newest revisions in a row came from a guided turn and are not ready. The list
 * is newest first, and a revision with no turn is an engineer's edit.
 */
export function uncleanDrafts(
  revisions: { turnKind: PlanningTurnKind | null; ready: boolean }[],
): number {
  const clean = revisions.findIndex((revision) => revision.turnKind !== 'guided' || revision.ready);
  return clean === -1 ? revisions.length : clean;
}
