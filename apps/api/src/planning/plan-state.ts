import type { PlanDecision, PlanQuestion, RunStatus } from '@plangineer/contracts';
import type { Executor } from '../db/client.ts';
import { findLatestTurn, type LatestTurn } from './planning-repository.ts';
import { findLatestQuestionsTurn, listTurnQuestions } from './question-repository.ts';
import { findLatestRevision, type StoredRevision } from './revision-repository.ts';

/** What the workspace shows and every plan write checks: the latest revision, turn and questions. */
export interface PlanState {
  revision: StoredRevision | undefined;
  turn: LatestTurn | undefined;
  /** The latest questions turn's questions while no revision is newer than that turn. */
  questions: PlanQuestion[];
  /** That turn's decisions while its questions show, and the latest revision's otherwise. */
  decisions: PlanDecision[];
}

export async function readPlanState(executor: Executor, featureId: string): Promise<PlanState> {
  const revision = await findLatestRevision(executor, featureId);
  const turn = await findLatestTurn(executor, featureId);
  const questionsTurn = await findLatestQuestionsTurn(executor, featureId);
  const questionsShow =
    questionsTurn !== undefined &&
    (revision === undefined || revision.createdAt <= questionsTurn.createdAt);
  if (questionsShow) {
    return {
      revision,
      turn,
      questions: await listTurnQuestions(executor, questionsTurn.id),
      decisions: questionsTurn.decisions,
    };
  }
  return {
    revision,
    turn,
    questions: [],
    decisions: revision === undefined ? [] : revision.body.decisions,
  };
}

export const openQuestions = (state: PlanState): PlanQuestion[] =>
  state.questions.filter((question) => question.answeredAt === null);

const RUNNING_STATUSES: RunStatus[] = ['queued', 'leased', 'running'];

/** Whether the latest turn's run is queued, leased or running. */
export const turnRunning = (state: PlanState): boolean =>
  state.turn !== undefined && RUNNING_STATUSES.includes(state.turn.status);
