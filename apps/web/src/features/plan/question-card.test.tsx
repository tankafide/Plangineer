import type { PlanQuestion } from '@plangineer/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/app-harness';
import { FEATURE_ID } from '@/test/feature-fixtures';
import { answerJson, answerProcedure } from '@/test/fixtures';
import { answerPlanWorkspace, planWorkspaceFixture } from '@/test/plan-fixtures';
import { PlanWorkspaceScreen } from './plan-workspace-screen';

const FIRST_ID = '0199c1a9-8888-7d4e-8f90-000000000001';
const SECOND_ID = '0199c1a9-8888-7d4e-8f90-000000000002';

function questionFixture(overrides: Partial<PlanQuestion> = {}): PlanQuestion {
  return {
    id: FIRST_ID,
    section: 'steps',
    prompt: 'Where does the export run?',
    choices: [
      { label: 'In the request', detail: 'Simple, but slow for big files.' },
      { label: 'In a background job', detail: 'Scales to any size.' },
    ],
    recommended: 1,
    answerChoice: null,
    answerText: null,
    answeredAt: null,
    ...overrides,
  };
}

const FIRST = questionFixture();
const SECOND = questionFixture({
  id: SECOND_ID,
  prompt: 'Which columns go in the file?',
  recommended: 0,
});
const QUESTIONS = [FIRST, SECOND];

const answered = (question: PlanQuestion): PlanQuestion => ({
  ...question,
  answerChoice: 1,
  answeredAt: '2026-10-10T10:05:00.000Z',
});

async function renderQuestions() {
  answerPlanWorkspace(answerJson(planWorkspaceFixture({ revision: null, questions: QUESTIONS })));
  await renderPage(() => <PlanWorkspaceScreen featureId={FEATURE_ID} />);
  return screen.findByRole('list', { name: 'Choices' });
}

describe('QuestionCard', () => {
  it('shows the first open question with its recommended choice first', async () => {
    const choices = await renderQuestions();

    expect(screen.getByText('Question 1 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Where does the export run?' })).toBeTruthy();
    const [first, second] = within(choices).getAllByRole('button');
    expect(first?.textContent).toContain('In a background job');
    expect(first?.textContent).toContain('Recommended');
    expect(second?.textContent).toContain('In the request');
  });

  it("sends a clicked choice's index in the question, and moves on to the next question", async () => {
    const answers = answerProcedure(
      'plan/answer',
      answerJson(planWorkspaceFixture({ revision: null, questions: [answered(FIRST), SECOND] })),
    );
    const choices = await renderQuestions();

    await userEvent.click(within(choices).getByRole('button', { name: /In the request/ }));

    await vi.waitFor(() => expect(answers).toEqual([{ questionId: FIRST_ID, choice: 0 }]));
    expect(await screen.findByText('Question 2 of 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Which columns go in the file?' })).toBeTruthy();
  });

  it('sends a typed answer as text', async () => {
    const answers = answerProcedure('plan/answer', answerJson(planWorkspaceFixture()));
    await renderQuestions();

    await userEvent.type(screen.getByLabelText('Your answer'), 'In a queue we already run');
    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));

    await vi.waitFor(() =>
      expect(answers).toEqual([{ questionId: FIRST_ID, text: 'In a queue we already run' }]),
    );
  });

  it('asks for an answer before sending an empty one', async () => {
    const answers = answerProcedure('plan/answer', answerJson(planWorkspaceFixture()));
    await renderQuestions();

    await userEvent.click(screen.getByRole('button', { name: 'Answer' }));

    expect(await screen.findByText('Write an answer, or pick a choice.')).toBeTruthy();
    expect(answers).toEqual([]);
  });
});
