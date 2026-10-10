import { describe, expect, it } from 'vitest';
import { PlanAnswerInput, PlanEditInput, PlanReviseStepInput, PlanWorkspace } from './plan.ts';
import { planBodyFixture, uuid } from './test-fixtures.ts';

const AT = '2026-10-10T12:00:00.000Z';
const ASK = { findings: 'ask', rounds: { mode: 'ask' } };

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    featureId: uuid(1),
    featureState: 'planning',
    runMode: 'manual',
    workflowSettings: {
      decisions: 'ask',
      planCheckIn: 'pause',
      planReview: ASK,
      implementationReview: ASK,
    },
    revision: {
      id: uuid(2),
      number: 1,
      source: 'agent',
      createdAt: AT,
      body: planBodyFixture(),
      acceptanceCriteria: [{ lineId: uuid(21), label: '1a', text: 'A plan renders as a PDF.' }],
      contextFiles: [{ id: uuid(3), title: 'Intake' }],
      baseCommits: [{ repositoryId: uuid(4), commit: 'a'.repeat(40) }],
    },
    turn: {
      id: uuid(5),
      kind: 'section_action',
      section: 'goal',
      action: 'expand',
      stepId: null,
      runId: uuid(6),
      status: 'succeeded',
      createdAt: AT,
    },
    questions: [
      {
        id: uuid(7),
        section: 'steps',
        prompt: 'Where should the PDF render?',
        choices: [
          { label: 'On the server', detail: '' },
          { label: 'In the browser', detail: '' },
        ],
        recommended: 0,
        answerChoice: null,
        answerText: null,
        answeredAt: null,
      },
    ],
    decisions: planBodyFixture().decisions,
    readiness: [{ key: 'open_questions', ok: false, count: 1 }],
    sections: [{ section: 'goal', status: 'complete' }],
    autoLoopStopped: false,
    ...overrides,
  };
}

describe('PlanAnswerInput', () => {
  it.each([
    { questionId: uuid(7), choice: 0 },
    { questionId: uuid(7), choice: 3 },
    { questionId: uuid(7), text: 'Render it on the server.' },
  ])('accepts %o', (input) => {
    expect(PlanAnswerInput.safeParse(input).success).toBe(true);
  });

  it.each([
    ['both a choice and text', { questionId: uuid(7), choice: 0, text: 'Server.' }],
    ['neither a choice nor text', { questionId: uuid(7) }],
    ['a choice of 4', { questionId: uuid(7), choice: 4 }],
    ['blank text', { questionId: uuid(7), text: '  ' }],
    ['text over 4,000 characters', { questionId: uuid(7), text: 'x'.repeat(4_001) }],
    ['an unknown key', { questionId: uuid(7), choice: 0, extra: true }],
  ])('rejects %s', (_name, input) => {
    expect(PlanAnswerInput.safeParse(input).success).toBe(false);
  });
});

describe('PlanWorkspace', () => {
  it('parses a workspace', () => {
    expect(PlanWorkspace.parse(workspace())).toEqual(workspace());
  });

  it('parses a workspace before the first draft', () => {
    const empty = workspace({ revision: null, turn: null, decisions: [] });
    expect(PlanWorkspace.parse(empty)).toEqual(empty);
  });

  it('strips an unknown key', () => {
    expect(PlanWorkspace.parse(workspace({ internal: 'x' }))).toEqual(workspace());
  });
});

describe('PlanEditInput', () => {
  it('accepts a body at a revision', () => {
    const input = { featureId: uuid(1), revision: 1, body: planBodyFixture() };
    expect(PlanEditInput.safeParse(input).success).toBe(true);
  });

  it.each([
    ['revision 0', { revision: 0 }],
    ['an invalid body', { body: planBodyFixture({ steps: [] }) }],
    ['an unknown key', { extra: true }],
  ])('rejects %s', (_name, overrides) => {
    const input = { featureId: uuid(1), revision: 1, body: planBodyFixture(), ...overrides };
    expect(PlanEditInput.safeParse(input).success).toBe(false);
  });
});

describe('PlanReviseStepInput', () => {
  it.each([
    ['a blank instruction', '  '],
    ['an instruction over 2,000 characters', 'x'.repeat(2_001)],
  ])('rejects %s', (_name, instruction) => {
    const input = { featureId: uuid(1), revision: 1, stepId: uuid(20), instruction };
    expect(PlanReviseStepInput.safeParse(input).success).toBe(false);
  });
});
