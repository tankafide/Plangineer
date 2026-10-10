import { describe, expect, it } from 'vitest';
import { jsonByteLength } from './json-bytes.ts';
import {
  PLANNING_OUTPUT_MAX_BYTES,
  PlanningOutput,
  QuestionDraft,
  SectionPatch,
} from './planning-output.ts';
import { planDraftFixture } from './test-fixtures.ts';

function question(overrides: Record<string, unknown> = {}) {
  return {
    section: 'steps',
    prompt: 'Where should the PDF render?',
    choices: [
      { label: 'On the server', detail: 'Fonts match the web view.' },
      { label: 'In the browser', detail: '' },
    ],
    recommended: 0,
    ...overrides,
  };
}

const decision = { id: 'new-1', title: 'Server rendering', reason: 'Fonts match.', by: 'agent' };
const step = planDraftFixture().steps[0];

const VALID_OUTPUTS = [
  { kind: 'questions', questions: [question()], decisions: [decision] },
  { kind: 'plan', plan: planDraftFixture() },
  { kind: 'section', patch: { section: 'goal', goal: 'Export plans.' } },
  { kind: 'step', step },
];

describe('PlanningOutput', () => {
  it.each(VALID_OUTPUTS)('accepts a $kind output', (output) => {
    expect(PlanningOutput.parse(output)).toEqual(output);
  });

  it('rejects a question whose recommended choice is past its choices', () => {
    const output = { kind: 'questions', questions: [question({ recommended: 2 })], decisions: [] };
    expect(PlanningOutput.safeParse(output).success).toBe(false);
  });

  it.each([
    ['no questions', { kind: 'questions', questions: [], decisions: [] }],
    [
      'six questions',
      { kind: 'questions', questions: Array.from({ length: 6 }, () => question()), decisions: [] },
    ],
    ['an unknown kind', { kind: 'thread', text: 'Hi' }],
    ['an unknown key', { kind: 'step', step, extra: true }],
    ['a draft that fails its own checks', { kind: 'plan', plan: planDraftFixture({ steps: [] }) }],
  ])('rejects %s', (_name, output) => {
    expect(PlanningOutput.safeParse(output).success).toBe(false);
  });

  it('rejects an output over 256 KiB', () => {
    const decisions = Array.from({ length: 100 }, (_, index) => ({
      ...decision,
      id: `new-${index}`,
      reason: 'x'.repeat(4_000),
    }));
    const output = { kind: 'questions', questions: [question()], decisions };
    expect(jsonByteLength(output)).toBeGreaterThan(PLANNING_OUTPUT_MAX_BYTES);
    expect(PlanningOutput.safeParse(output).success).toBe(false);
  });
});

describe('QuestionDraft', () => {
  it.each([
    ['one choice', { choices: [{ label: 'Only', detail: '' }] }],
    ['five choices', { choices: Array.from({ length: 5 }, () => ({ label: 'A', detail: '' })) }],
    ['a recommended index of 4', { recommended: 4 }],
    ['a blank prompt', { prompt: ' ' }],
    ['an unknown section', { section: 'findings' }],
  ])('rejects %s', (_name, overrides) => {
    expect(QuestionDraft.safeParse(question(overrides)).success).toBe(false);
  });

  it('accepts a recommended last choice of four', () => {
    const choices = Array.from({ length: 4 }, () => ({ label: 'A', detail: '' }));
    expect(QuestionDraft.safeParse(question({ choices, recommended: 3 })).success).toBe(true);
  });
});

describe('SectionPatch', () => {
  it.each([
    { section: 'goal', goal: 'Export plans.' },
    { section: 'prerequisites', prerequisites: [] },
    { section: 'steps', steps: [step] },
    { section: 'decisions', decisions: [decision] },
    { section: 'constraints', constraints: [] },
    { section: 'test_plan', coverage: [{ lineId: 'new-2', ticks: ['unit'] }] },
    { section: 'verification', verification: { automated: [], agentChecks: [], humanChecks: [] } },
  ])('accepts a $section patch', (patch) => {
    expect(SectionPatch.parse(patch)).toEqual(patch);
  });

  it.each([
    { section: 'goal', steps: [step] },
    { section: 'steps', steps: [] },
    { section: 'test_plan', coverage: [{ lineId: 'new-2', ticks: [], stale: true }] },
  ])('rejects the mismatched patch %#', (patch) => {
    expect(SectionPatch.safeParse(patch).success).toBe(false);
  });
});
