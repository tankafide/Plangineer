import { PlanDecision, PlanQuestion, type QuestionDraft } from '@plangineer/contracts';
import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Executor, Transaction } from '../db/client.ts';
import { features, planningTurns, planQuestions } from '../db/schema.ts';
import { toIsoOrNull } from '../lib/dates.ts';

const QUESTIONS_PER_TURN_MAX = 5;

export interface QuestionsTurn {
  id: string;
  createdAt: Date;
  decisions: PlanDecision[];
}

/** The feature's newest turn whose output was questions, which set its decisions. */
export async function findLatestQuestionsTurn(
  executor: Executor,
  featureId: string,
): Promise<QuestionsTurn | undefined> {
  const [row] = await executor
    .select({
      id: planningTurns.id,
      createdAt: planningTurns.createdAt,
      decisions: planningTurns.decisions,
    })
    .from(planningTurns)
    .where(and(eq(planningTurns.featureId, featureId), isNotNull(planningTurns.decisions)))
    .orderBy(desc(planningTurns.id))
    .limit(1);
  if (row === undefined) return undefined;
  return { ...row, decisions: PlanDecision.array().parse(row.decisions) };
}

const questionColumns = {
  id: planQuestions.id,
  section: planQuestions.section,
  prompt: planQuestions.prompt,
  choices: planQuestions.choices,
  recommended: planQuestions.recommended,
  answerChoice: planQuestions.answerChoice,
  answerText: planQuestions.answerText,
  answeredAt: planQuestions.answeredAt,
};

function toQuestion(row: { answeredAt: Date | null } & Omit<PlanQuestion, 'answeredAt'>) {
  return PlanQuestion.parse({ ...row, answeredAt: toIsoOrNull(row.answeredAt) });
}

/** A turn's questions in the order the agent asked them. */
export async function listTurnQuestions(
  executor: Executor,
  turnId: string,
): Promise<PlanQuestion[]> {
  const rows = await executor
    .select(questionColumns)
    .from(planQuestions)
    .where(eq(planQuestions.turnId, turnId))
    .orderBy(asc(planQuestions.position))
    .limit(QUESTIONS_PER_TURN_MAX);
  return rows.map(toQuestion);
}

/** The feature's latest answered questions, oldest first. */
export async function listAnsweredQuestions(
  executor: Executor,
  featureId: string,
  limit: number,
): Promise<PlanQuestion[]> {
  const rows = await executor
    .select(questionColumns)
    .from(planQuestions)
    .innerJoin(planningTurns, eq(planningTurns.id, planQuestions.turnId))
    .where(and(eq(planningTurns.featureId, featureId), isNotNull(planQuestions.answeredAt)))
    .orderBy(desc(planQuestions.turnId), desc(planQuestions.position))
    .limit(limit);
  return rows.map(toQuestion).toReversed();
}

/** Stores a questions output: the questions at positions 0 to n−1, and the turn's decisions. */
export async function insertQuestions(
  tx: Transaction,
  turnId: string,
  questions: QuestionDraft[],
  decisions: PlanDecision[],
): Promise<void> {
  await tx.insert(planQuestions).values(
    questions.map((question, position) => ({
      turnId,
      position,
      section: question.section,
      prompt: question.prompt,
      choices: PlanQuestion.shape.choices.parse(question.choices),
      recommended: question.recommended,
    })),
  );
  await tx
    .update(planningTurns)
    .set({ decisions: PlanDecision.array().parse(decisions) })
    .where(and(eq(planningTurns.id, turnId), isNull(planningTurns.decisions)));
}

/** The feature of the author's question, or undefined for anyone else's. */
export async function findQuestionFeature(
  executor: Executor,
  authorId: string,
  questionId: string,
): Promise<string | undefined> {
  const [row] = await executor
    .select({ featureId: features.id })
    .from(planQuestions)
    .innerJoin(planningTurns, eq(planningTurns.id, planQuestions.turnId))
    .innerJoin(features, eq(features.id, planningTurns.featureId))
    .where(and(eq(planQuestions.id, questionId), eq(features.authorId, authorId)));
  return row?.featureId;
}

/** Stores the answer of an unanswered question. */
export async function answerQuestion(
  tx: Transaction,
  questionId: string,
  answer: { choice: number | null; text: string | null },
): Promise<void> {
  const rows = await tx
    .update(planQuestions)
    .set({ answerChoice: answer.choice, answerText: answer.text, answeredAt: sql`now()` })
    .where(and(eq(planQuestions.id, questionId), isNull(planQuestions.answeredAt)))
    .returning({ id: planQuestions.id });
  if (rows.length === 0) throw new Error(`Question ${questionId} was answered under its lock`);
}
