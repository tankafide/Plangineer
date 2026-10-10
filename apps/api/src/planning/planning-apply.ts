import { randomUUID } from 'node:crypto';
import {
  type PlanBody,
  PlanBody as PlanBodySchema,
  type PlanningOutput,
} from '@plangineer/contracts';
import {
  type AdoptContext,
  adoptDraft,
  afterPlanningTurn,
  alignCoverage,
  AUTO_DRAFTS_MAX,
  isReady,
  mergeSection,
  outputFits,
  planReadiness,
  replaceStep,
  uncleanDrafts,
} from '@plangineer/domain';
import type { Transaction } from '../db/client.ts';
import {
  type LockedFeature,
  lockFeature,
  updateFeatureState,
} from '../features/feature-repository.ts';
import { shareRunnerUnlessLocked } from '../runners/runner-repository.ts';
import type { RunFailedBody } from '../runs/run-event-checks.ts';
import type { AppendOptions } from '../runs/run-events-repository.ts';
import { findPlanningSubject, findTurnOfRun, type TurnOfRun } from './planning-repository.ts';
import { queueTurn } from './planning-turns.ts';
import { insertQuestions } from './question-repository.ts';
import { findLatestRevision, listRecentRevisions } from './revision-repository.ts';
import { storeRevision } from './revisions.ts';

function invalidOutput(message: string): RunFailedBody {
  return { type: 'run.failed', reason: 'invalid_output', message, exitCode: null, stderrTail: [] };
}

const isReadyBody = (body: PlanBody) => isReady(planReadiness(body, 0));

type DraftOutput = Exclude<PlanningOutput, { kind: 'questions' }>;

/** The body a plan, section or step output makes from the latest body, or why it cannot. */
function draftedBody(
  output: DraftOutput,
  base: PlanBody | null,
  turn: TurnOfRun,
  ctx: AdoptContext,
): PlanBody | string {
  if (output.kind === 'plan') return adoptDraft(output.plan, base, ctx);
  if (base === null) throw new Error(`Turn ${turn.id} changes a plan its feature does not have`);
  if (output.kind === 'section') return mergeSection(base, output.patch, ctx);
  if (turn.stepId === null) throw new Error(`Step turn ${turn.id} names no step`);
  if (!base.steps.some((step) => step.id === turn.stepId)) {
    return 'The step the turn revises is no longer in the plan.';
  }
  return replaceStep(base, turn.stepId, output.step, ctx);
}

/**
 * What follows a stored draft (D6): marks the feature ready, or queues the next guided turn on
 * the same runner when its row is free and active, so a concurrent revoke either waits and then
 * cancels the new run or makes this one skip it. The new turn reads the current run mode.
 */
async function continuePlanning(
  tx: Transaction,
  options: AppendOptions,
  {
    turn,
    feature,
    featureId,
    outputKind,
    body,
  }: {
    turn: TurnOfRun;
    feature: LockedFeature;
    featureId: string;
    outputKind: DraftOutput['kind'];
    body: PlanBody;
  },
): Promise<void> {
  const recent = await listRecentRevisions(tx, featureId, AUTO_DRAFTS_MAX);
  const next = afterPlanningTurn({
    turnKind: turn.kind,
    outputKind,
    planCheckIn: turn.job.settings.planCheckIn,
    ready: isReadyBody(body),
    uncleanDrafts: uncleanDrafts(
      recent.map((revision) => ({
        turnKind: revision.turnKind,
        ready: isReadyBody(revision.body),
      })),
    ),
  });
  if (next === 'mark_ready') await updateFeatureState(tx, featureId, 'ready_for_review');
  if (next !== 'queue_guided') return;
  const runner = await shareRunnerUnlessLocked(tx, turn.runnerId);
  if (runner === undefined || runner.status !== 'active') {
    options.logger.info(
      { featureId, runnerId: turn.runnerId },
      'Auto loop left waiting for its runner',
    );
    return;
  }
  await queueTurn(
    tx,
    options,
    { id: featureId, authorId: feature.authorId, runMode: feature.runMode },
    { kind: 'guided' },
    turn.runnerId,
  );
}

/**
 * Applies a planning run's output in the transaction that stores its run.succeeded (D2), under
 * the feature's lock: questions are stored with the turn's decisions, and a plan, section or
 * step output becomes the next revision. Returns an invalid_output failure, storing nothing,
 * for an output its turn may not write or one that makes an invalid plan.
 */
export async function applyPlanningOutput(
  tx: Transaction,
  runId: string,
  output: PlanningOutput,
  options: AppendOptions,
): Promise<RunFailedBody | null> {
  const turn = await findTurnOfRun(tx, runId);
  if (turn === undefined) throw new Error(`Planning run ${runId} has no turn`);
  const feature = await lockFeature(tx, turn.featureId);
  if (feature === undefined) throw new Error(`Turn ${turn.id} has no feature`);
  if (!outputFits(turn, output, turn.job.settings.decisions)) {
    return invalidOutput(`A ${output.kind} output does not fit a ${turn.kind} turn.`);
  }
  if (output.kind === 'questions') {
    const decisions = output.decisions.map((decision) => ({ ...decision, id: randomUUID() }));
    await insertQuestions(tx, turn.id, output.questions, decisions);
    return null;
  }
  const subject = await findPlanningSubject(tx, turn.featureId);
  const latest = await findLatestRevision(tx, turn.featureId);
  if (subject === undefined) throw new Error(`Feature ${turn.featureId} has no repository`);
  const ctx = { repositoryId: subject.repository.id, newId: randomUUID };
  const drafted = draftedBody(output, latest === undefined ? null : latest.body, turn, ctx);
  if (typeof drafted === 'string') return invalidOutput(drafted);
  const parsed = PlanBodySchema.safeParse(alignCoverage(drafted));
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    if (issue === undefined) throw new Error(`Planning run ${runId} failed a parse with no issue`);
    const where = issue.path.length === 0 ? '' : ` at ${issue.path.join('.')}`;
    return invalidOutput(`The output makes an invalid plan${where}: ${issue.message}`);
  }
  if (turn.commit === null) throw new Error(`Planning run ${runId} succeeded with no commit`);
  const body = await storeRevision(tx, turn.featureId, parsed.data, {
    source: 'agent',
    turnId: turn.id,
    repositoryId: subject.repository.id,
    commit: turn.commit,
    rewroteCoverage:
      output.kind === 'plan' || (output.kind === 'section' && output.patch.section === 'test_plan'),
  });
  await continuePlanning(tx, options, {
    turn,
    feature,
    featureId: turn.featureId,
    outputKind: output.kind,
    body,
  });
  return null;
}
