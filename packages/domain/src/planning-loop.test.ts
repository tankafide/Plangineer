import type { PlanningOutput } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { AUTO_DRAFTS_MAX, afterPlanningTurn, outputFits, uncleanDrafts } from './planning-loop.ts';

const draftStep = { id: 'new-1', title: 'Render', files: [], body: '', doneWhen: [] };

const OUTPUTS = {
  questions: {
    kind: 'questions',
    questions: [
      {
        section: 'steps',
        prompt: 'Where does it render?',
        choices: [
          { label: 'Server', detail: '' },
          { label: 'Browser', detail: '' },
        ],
        recommended: 0,
      },
    ],
    decisions: [],
  },
  plan: {
    kind: 'plan',
    plan: {
      goal: 'Export plans.',
      prerequisites: [],
      steps: [draftStep],
      decisions: [],
      constraints: [],
      coverage: [],
      blockers: [],
      verification: { automated: [], agentChecks: [], humanChecks: [] },
    },
  },
  goal: { kind: 'section', patch: { section: 'goal', goal: 'Export plans.' } },
  step: { kind: 'step', step: draftStep },
} satisfies Record<string, PlanningOutput>;

const guided = { kind: 'guided', section: null } as const;
const goalAction = { kind: 'section_action', section: 'goal' } as const;
const stepsAction = { kind: 'section_action', section: 'steps' } as const;
const revise = { kind: 'revise_step', section: null } as const;

describe('outputFits', () => {
  it.each([
    ['a guided turn', guided, 'plan', 'ask', true],
    ['a guided turn', guided, 'plan', 'recommended', true],
    ['a guided turn', guided, 'questions', 'ask', true],
    ['a guided turn', guided, 'questions', 'recommended', false],
    ['a guided turn', guided, 'goal', 'ask', false],
    ['a guided turn', guided, 'step', 'ask', false],
    ['a goal action', goalAction, 'goal', 'ask', true],
    ['a steps action', stepsAction, 'goal', 'ask', false],
    ['a goal action', goalAction, 'plan', 'ask', false],
    ['a goal action', goalAction, 'questions', 'ask', false],
    ['a step revision', revise, 'step', 'recommended', true],
    ['a step revision', revise, 'plan', 'ask', false],
    ['a step revision', revise, 'goal', 'ask', false],
  ] as const)('%s with a %s output under %s fits: %s', (_name, turn, output, decisions, fits) => {
    expect(outputFits(turn, OUTPUTS[output], decisions)).toBe(fits);
  });
});

const result = (overrides: Partial<Parameters<typeof afterPlanningTurn>[0]> = {}) => ({
  turnKind: 'guided' as const,
  outputKind: 'plan' as const,
  planCheckIn: 'skip' as const,
  ready: false,
  uncleanDrafts: 1,
  ...overrides,
});

describe('afterPlanningTurn', () => {
  it.each([
    ['questions', result({ outputKind: 'questions' }), 'wait'],
    [
      'a section action',
      result({ turnKind: 'section_action', outputKind: 'section', ready: true }),
      'wait',
    ],
    [
      'a step revision',
      result({ turnKind: 'revise_step', outputKind: 'step', ready: true }),
      'wait',
    ],
    ['a guided draft under pause', result({ planCheckIn: 'pause', ready: true }), 'wait'],
    ['a ready guided draft under skip', result({ ready: true, uncleanDrafts: 0 }), 'mark_ready'],
    ['an unready first draft under skip', result({ uncleanDrafts: 1 }), 'queue_guided'],
    ['an unready second draft under skip', result({ uncleanDrafts: 2 }), 'queue_guided'],
    ['an unready third draft under skip', result({ uncleanDrafts: AUTO_DRAFTS_MAX }), 'stop'],
  ] as const)('after %s gives the expected result', (_name, input, next) => {
    expect(afterPlanningTurn(input)).toBe(next);
  });
});

describe('uncleanDrafts', () => {
  it.each([
    ['no revisions', [], 0],
    [
      'three unready guided drafts',
      [
        { turnKind: 'guided', ready: false },
        { turnKind: 'guided', ready: false },
        { turnKind: 'guided', ready: false },
      ],
      3,
    ],
    [
      'a newest ready draft',
      [
        { turnKind: 'guided', ready: true },
        { turnKind: 'guided', ready: false },
      ],
      0,
    ],
    [
      'an engineer edit behind one unready draft',
      [
        { turnKind: 'guided', ready: false },
        { turnKind: null, ready: false },
        { turnKind: 'guided', ready: false },
      ],
      1,
    ],
    [
      'a section action behind two unready drafts',
      [
        { turnKind: 'guided', ready: false },
        { turnKind: 'guided', ready: false },
        { turnKind: 'section_action', ready: false },
      ],
      2,
    ],
  ] as const)('counts %s', (_name, revisions, count) => {
    expect(uncleanDrafts([...revisions])).toBe(count);
  });
});
