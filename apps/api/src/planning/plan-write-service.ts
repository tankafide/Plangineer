import type {
  FeatureState,
  PlanAnswerInput,
  PlanConflictReason,
  PlanEditInput,
  PlanReviseStepInput,
  PlanSectionActionInput,
  PlanWorkspace,
} from '@plangineer/contracts';
import { isReady, planOpen, planReadiness } from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import { lockFeatureForAuthor, updateFeatureState } from '../features/feature-repository.ts';
import { err, fail, ok, type Result } from '../lib/result.ts';
import type { ServiceDeps } from '../lib/service-deps.ts';
import { lockActiveRunner } from '../runners/runner-pick.ts';
import { wakeRunner } from '../runners/runner-repository.ts';
import type { TurnSpec } from './planning-inputs.ts';
import { findPlanningSubject, type LatestTurn } from './planning-repository.ts';
import { queueTurn } from './planning-turns.ts';
import { openQuestions, type PlanState, readPlanState, turnRunning } from './plan-state.ts';
import { readWorkspaceAfterWrite } from './plan-service.ts';
import { answerQuestion, findQuestionFeature } from './question-repository.ts';
import { storeRevision } from './revisions.ts';

type WriteError = 'NOT_FOUND' | 'CONFLICT' | 'RUNNER_REQUIRED' | 'INPUT_VALIDATION_FAILED';

const conflict = (reason: PlanConflictReason) => err('CONFLICT', { reason });

const invalidInput = (field: string, message: string) =>
  err('INPUT_VALIDATION_FAILED', { formErrors: [], fieldErrors: { [field]: [message] } });

interface LockedPlan {
  feature: { state: FeatureState; runMode: PlanWorkspace['runMode'] };
  state: PlanState;
}

/**
 * Locks the author's feature and reads its plan, then checks it is open and, for a write that
 * needs the agent idle, that no turn runs and no question is open, and that the revision the
 * engineer saw is still the latest.
 */
async function lockPlan(
  tx: Transaction,
  userId: string,
  featureId: string,
  checks: { idle: boolean; revision?: number },
): Promise<Result<LockedPlan, 'NOT_FOUND' | 'CONFLICT'>> {
  const feature = await lockFeatureForAuthor(tx, userId, featureId);
  if (feature === undefined) return fail('NOT_FOUND');
  if (!planOpen(feature.state)) return conflict('not_planning');
  const state = await readPlanState(tx, featureId);
  if (checks.idle && turnRunning(state)) return conflict('turn_running');
  if (checks.idle && openQuestions(state).length > 0) return conflict('questions_open');
  if (checks.revision !== undefined && state.revision?.number !== checks.revision) {
    return conflict('stale_revision');
  }
  return ok({ feature, state });
}

/** Every plan write but Mark ready sends a ready_for_review feature back to planning. */
async function reopen(tx: Transaction, featureId: string, state: FeatureState): Promise<void> {
  if (state === 'ready_for_review') await updateFeatureState(tx, featureId, 'planning');
}

/** Queues a turn on the viewer's runner, or answers RUNNER_REQUIRED having stored nothing. */
async function queueOnViewerRunner(
  tx: Transaction,
  deps: ServiceDeps,
  userId: string,
  featureId: string,
  { feature }: LockedPlan,
  spec: TurnSpec,
): Promise<Result<string, 'RUNNER_REQUIRED'>> {
  const runner = await lockActiveRunner(tx, userId);
  if (!runner.ok) return runner;
  await reopen(tx, featureId, feature.state);
  await queueTurn(
    tx,
    { leaseDurationMs: deps.env.RUN_LEASE_DURATION_MS, logger: deps.logger },
    { id: featureId, authorId: userId, runMode: feature.runMode },
    spec,
    runner.value,
  );
  return runner;
}

/**
 * Runs one plan write in a transaction, wakes the runner it queued a turn on, and answers the
 * workspace after the commit.
 */
async function writePlan<E extends WriteError>(
  deps: ServiceDeps,
  userId: string,
  featureId: string,
  write: (tx: Transaction) => Promise<Result<string | null, E>>,
): Promise<Result<PlanWorkspace, E>> {
  const written = await deps.db.transaction(write);
  if (!written.ok) return written;
  if (written.value !== null) await wakeRunner(deps.db, written.value);
  return ok(await readWorkspaceAfterWrite(deps, userId, featureId));
}

/** Stores an answer, and queues the next guided turn once the turn's last question is answered. */
export async function answerPlanQuestion(
  deps: ServiceDeps,
  userId: string,
  input: PlanAnswerInput,
): Promise<Result<PlanWorkspace, WriteError>> {
  const featureId = await findQuestionFeature(deps.db, userId, input.questionId);
  if (featureId === undefined) return fail('NOT_FOUND');
  return writePlan<WriteError>(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: false });
    if (!locked.ok) return locked;
    const question = locked.value.state.questions.find(({ id }) => id === input.questionId);
    if (question === undefined) return conflict('question_closed');
    if (question.answeredAt !== null) return conflict('answered');
    if (input.choice !== undefined && input.choice >= question.choices.length) {
      return invalidInput('choice', "must index one of the question's choices");
    }
    const last = openQuestions(locked.value.state).length === 1;
    const runner = last ? await lockActiveRunner(tx, userId) : ok(null);
    if (!runner.ok) return runner;
    await answerQuestion(tx, question.id, {
      choice: input.choice ?? null,
      text: input.text ?? null,
    });
    if (runner.value === null) {
      await reopen(tx, featureId, locked.value.feature.state);
      return ok(null);
    }
    return queueOnViewerRunner(tx, deps, userId, featureId, locked.value, { kind: 'guided' });
  });
}

export function continuePlanning(deps: ServiceDeps, userId: string, featureId: string) {
  return writePlan(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: true });
    if (!locked.ok) return locked;
    return queueOnViewerRunner(tx, deps, userId, featureId, locked.value, { kind: 'guided' });
  });
}

/** The spec a turn ran with, to queue it again. */
function specOf(turn: LatestTurn): TurnSpec {
  switch (turn.kind) {
    case 'guided':
      return { kind: 'guided' };
    case 'section_action':
      if (turn.section === null || turn.action === null) throw new Error(`Turn ${turn.id} is bad`);
      return { kind: 'section_action', section: turn.section, action: turn.action };
    case 'revise_step':
      if (turn.stepId === null || turn.instruction === null) {
        throw new Error(`Turn ${turn.id} is bad`);
      }
      return { kind: 'revise_step', stepId: turn.stepId, instruction: turn.instruction };
    default: {
      const unhandled: never = turn.kind;
      throw new Error(`Unhandled planning turn kind ${String(unhandled)}`);
    }
  }
}

const hasStep = ({ state }: LockedPlan, stepId: string) =>
  state.revision !== undefined && state.revision.body.steps.some((step) => step.id === stepId);

/** Queues the latest turn's spec again after it failed or was cancelled. */
export function retryTurn(deps: ServiceDeps, userId: string, featureId: string) {
  return writePlan(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: false });
    if (!locked.ok) return locked;
    const { turn } = locked.value.state;
    if (turn === undefined || (turn.status !== 'failed' && turn.status !== 'cancelled')) {
      return conflict('nothing_to_retry');
    }
    const spec = specOf(turn);
    if (spec.kind === 'revise_step' && !hasStep(locked.value, spec.stepId))
      return fail('NOT_FOUND');
    return queueOnViewerRunner(tx, deps, userId, featureId, locked.value, spec);
  });
}

/** Stores the engineer's body as the next revision, with the rows of changed steps stale. */
export function editPlan(deps: ServiceDeps, userId: string, input: PlanEditInput) {
  const { featureId } = input;
  return writePlan<'NOT_FOUND' | 'CONFLICT' | 'INPUT_VALIDATION_FAILED'>(
    deps,
    userId,
    featureId,
    async (tx) => {
      const locked = await lockPlan(tx, userId, featureId, {
        idle: true,
        revision: input.revision,
      });
      if (!locked.ok) return locked;
      const subject = await findPlanningSubject(tx, featureId);
      if (subject === undefined) throw new Error(`Feature ${featureId} has no repository`);
      if (input.body.steps.some((step) => step.repositoryId !== subject.repository.id)) {
        return invalidInput('body.steps', 'must each name the feature repository');
      }
      await storeRevision(tx, featureId, input.body, { source: 'engineer', authorId: userId });
      await reopen(tx, featureId, locked.value.feature.state);
      return ok(null);
    },
  );
}

export function runSectionAction(deps: ServiceDeps, userId: string, input: PlanSectionActionInput) {
  const { featureId } = input;
  return writePlan(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: true, revision: input.revision });
    if (!locked.ok) return locked;
    return queueOnViewerRunner(tx, deps, userId, featureId, locked.value, {
      kind: 'section_action',
      section: input.section,
      action: input.action,
    });
  });
}

export function reviseStep(deps: ServiceDeps, userId: string, input: PlanReviseStepInput) {
  const { featureId } = input;
  return writePlan(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: true, revision: input.revision });
    if (!locked.ok) return locked;
    if (!hasStep(locked.value, input.stepId)) return fail('NOT_FOUND');
    return queueOnViewerRunner(tx, deps, userId, featureId, locked.value, {
      kind: 'revise_step',
      stepId: input.stepId,
      instruction: input.instruction,
    });
  });
}

/** Moves a plan that passes every readiness item to ready_for_review. */
export function markPlanReady(
  deps: ServiceDeps,
  userId: string,
  { featureId, revision }: { featureId: string; revision: number },
) {
  return writePlan(deps, userId, featureId, async (tx) => {
    const locked = await lockPlan(tx, userId, featureId, { idle: true, revision });
    if (!locked.ok) return locked;
    const { state } = locked.value;
    if (state.revision === undefined) throw new Error(`Feature ${featureId} lost its revision`);
    if (!isReady(planReadiness(state.revision.body, 0))) return conflict('not_ready');
    await updateFeatureState(tx, featureId, 'ready_for_review');
    return ok(null);
  });
}
