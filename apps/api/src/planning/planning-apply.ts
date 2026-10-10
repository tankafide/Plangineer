import { randomUUID } from 'node:crypto';
import {
  type PlanBody,
  PlanBody as PlanBodySchema,
  type PlanningOutput,
  type PlanningTurnKind,
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
import type { Executor, Transaction } from '../db/client.ts';
import { lockFeature, updateFeatureState } from '../features/feature-repository.ts';
import { lockRunnerForUser } from '../runners/runner-repository.ts';
import type { RunFailedBody } from '../runs/run-event-checks.ts';
import type { AppendOptions } from '../runs/run-events-repository.ts';
import {
  findLatestTurn,
  findPlanningSubject,
  findTurnOfRun,
  type TurnOfRun,
} from './planning-repository.ts';
import { queueTurn } from './planning-turns.ts';
import { insertQuestions } from './question-repository.ts';
import { findLatestRevision, listRecentRevisions } from './revision-repository.ts';
import { storeRevision } from './revisions.ts';

function invalidOutput(message: string): RunFailedBody {
  return { type: 'run.failed', reason: 'invalid_output', message, exitCode: null, stderrTail: [] };
}

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

/** What queuing a turn needs: the lease length and the logger. */
type QueueOptions = Pick<AppendOptions, 'leaseDurationMs' | 'logger'>;

const isDraftReady = (body: PlanBody) => isReady(planReadiness(body, 0));

/** What follows the draft a turn stored (D6), by the settings its run started with. */
async function nextAfterDraft(
  executor: Executor,
  turn: TurnOfRun,
  outputKind: DraftOutput['kind'],
  body: PlanBody,
) {
  const recent = await listRecentRevisions(executor, turn.featureId, AUTO_DRAFTS_MAX);
  return afterPlanningTurn({
    turnKind: turn.kind,
    outputKind,
    planCheckIn: turn.job.settings.planCheckIn,
    ready: isDraftReady(body),
    uncleanDrafts: uncleanDrafts(
      recent.map((revision) => ({
        turnKind: revision.turnKind,
        ready: isDraftReady(revision.body),
      })),
    ),
  });
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
  const next = await nextAfterDraft(tx, turn, output.kind, body);
  if (next === 'mark_ready') await updateFeatureState(tx, turn.featureId, 'ready_for_review');
  return null;
}

/** The output kind a turn's revision came from, since each turn kind takes one draft kind. */
const DRAFT_KINDS: Record<PlanningTurnKind, DraftOutput['kind']> = {
  guided: 'plan',
  section_action: 'section',
  revise_step: 'step',
};

/**
 * Queues the Auto loop's next guided turn once a run whose unready draft is still the feature's
 * latest revision and turn has ended (D6). It runs after that run's transaction, locking the
 * feature and then the runner as every plan write does, so a busy runner row only makes it wait
 * and a revoke orders before it (no turn is queued) or after it (the revoke cancels the new
 * run). The new turn reads the current run mode. Returns the runner to wake.
 */
export async function queueAutoLoopTurn(
  tx: Transaction,
  options: QueueOptions,
  runId: string,
): Promise<string | undefined> {
  const turn = await findTurnOfRun(tx, runId);
  if (turn === undefined) return undefined;
  const feature = await lockFeature(tx, turn.featureId);
  if (feature?.state !== 'planning') return undefined;
  const latestTurn = await findLatestTurn(tx, turn.featureId);
  const latest = await findLatestRevision(tx, turn.featureId);
  if (
    latestTurn?.id !== turn.id ||
    latestTurn.status !== 'succeeded' ||
    latest === undefined ||
    latest.turnId !== turn.id
  ) {
    return undefined;
  }
  const next = await nextAfterDraft(tx, turn, DRAFT_KINDS[turn.kind], latest.body);
  if (next !== 'queue_guided') return undefined;
  const runner = await lockRunnerForUser(tx, feature.authorId, turn.runnerId);
  if (runner === undefined || runner.status !== 'active') {
    options.logger.info(
      { featureId: turn.featureId, runnerId: turn.runnerId },
      'Auto loop left waiting for its runner',
    );
    return undefined;
  }
  await queueTurn(
    tx,
    options,
    { id: turn.featureId, authorId: feature.authorId, runMode: feature.runMode },
    { kind: 'guided' },
    turn.runnerId,
  );
  return turn.runnerId;
}
