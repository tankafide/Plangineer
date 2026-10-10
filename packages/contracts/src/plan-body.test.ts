import { describe, expect, it } from 'vitest';
import { jsonByteLength } from './json-bytes.ts';
import { PLAN_BODY_MAX_BYTES, PlanBody, PlanDraft, type PlanStep } from './plan-body.ts';
import { planBodyFixture, planDraftFixture, REPOSITORY_ID, uuid } from './test-fixtures.ts';

const firstStep = planBodyFixture().steps[0]!;
const secondStep = planBodyFixture().steps[1]!;

const filler = (index: number, body: string): PlanStep => ({
  id: uuid(1_000 + index),
  repositoryId: REPOSITORY_ID,
  title: 'Filler',
  files: [],
  body,
  doneWhen: [],
});

/** A valid body that serializes to exactly the given number of bytes. */
function bodyOfBytes(bytes: number): PlanBody {
  const steps = [firstStep, secondStep];
  const sizeWithLast = () => jsonByteLength(planBodyFixture({ steps: [...steps, filler(99, '')] }));
  while (sizeWithLast() + 20_000 < bytes) steps.push(filler(steps.length, 'x'.repeat(20_000)));
  const last = filler(99, 'x'.repeat(bytes - sizeWithLast()));
  return planBodyFixture({ steps: [...steps, last] });
}

const lines = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: uuid(500 + index), text: `Line ${index}` }));

describe('PlanBody', () => {
  it('accepts a full body', () => {
    expect(PlanBody.parse(planBodyFixture())).toEqual(planBodyFixture());
  });

  it('accepts a body of exactly 256 KiB', () => {
    const body = bodyOfBytes(PLAN_BODY_MAX_BYTES);
    expect(jsonByteLength(body)).toBe(PLAN_BODY_MAX_BYTES);
    expect(PlanBody.safeParse(body).success).toBe(true);
  });

  it('rejects a body over 256 KiB', () => {
    const body = bodyOfBytes(PLAN_BODY_MAX_BYTES + 1);
    expect(PlanBody.safeParse(body).success).toBe(false);
  });

  it.each([
    [
      'a duplicate id across sections',
      { decisions: [{ id: uuid(20), title: 'Repeat', reason: 'Same id.', by: 'agent' }] },
    ],
    [
      'a coverage row naming no line',
      { coverage: [{ lineId: uuid(999), ticks: ['unit'], stale: false }] },
    ],
    [
      'a coverage row naming a step instead of a line',
      { coverage: [{ lineId: uuid(20), ticks: [], stale: false }] },
    ],
    [
      'a blocker naming no step',
      { blockers: [{ id: uuid(60), section: 'steps', stepId: uuid(999), text: 'Gone.' }] },
    ],
    ['a step with 13 done-when lines', { steps: [{ ...firstStep, doneWhen: lines(13) }] }],
    ['no steps', { steps: [] }],
    ['61 steps', { steps: Array.from({ length: 61 }, (_, index) => filler(index, '')) }],
    [
      'a repeated tick',
      { coverage: [{ lineId: uuid(21), ticks: ['unit', 'unit'], stale: false }] },
    ],
    ['a free-text id', { decisions: [{ id: 'new-1', title: 'T', reason: 'R', by: 'agent' }] }],
    ['a step with no repository', { steps: [{ ...secondStep, repositoryId: undefined }] }],
    ['a row with no stale flag', { coverage: [{ lineId: uuid(21), ticks: [] }] }],
    ['a blank goal', { goal: '  ' }],
    ['an unknown key', { extra: true }],
  ])('rejects %s', (_name, overrides) => {
    const body = { ...planBodyFixture(), ...overrides };
    expect(PlanBody.safeParse(body).success).toBe(false);
  });

  it('accepts a step with 12 done-when lines', () => {
    const body = planBodyFixture({
      steps: [{ ...firstStep, doneWhen: [...firstStep.doneWhen, ...lines(10)] }, secondStep],
    });
    expect(PlanBody.safeParse(body).success).toBe(true);
  });

  it('names the coverage row that points at no line', () => {
    const body = planBodyFixture({ coverage: [{ lineId: uuid(999), ticks: [], stale: false }] });
    expect(PlanBody.safeParse(body).error?.issues[0]?.path).toEqual(['coverage', 0, 'lineId']);
  });
});

describe('PlanDraft', () => {
  it('accepts free-text ids such as new-1', () => {
    expect(PlanDraft.parse(planDraftFixture())).toEqual(planDraftFixture());
  });

  it.each([
    [
      'a duplicate id',
      { decisions: [{ id: 'new-1', title: 'Repeat', reason: 'Same id.', by: 'agent' }] },
    ],
    ['a coverage row naming no line', { coverage: [{ lineId: 'new-9', ticks: [] }] }],
    [
      'a blocker naming no step',
      { blockers: [{ id: 'new-4', section: 'steps', stepId: 'new-9', text: 'Gone.' }] },
    ],
    ['a stale flag on a row', { coverage: [{ lineId: 'new-2', ticks: [], stale: false }] }],
    [
      'an id over 64 characters',
      { decisions: [{ id: 'x'.repeat(65), title: 'T', reason: 'R', by: 'agent' }] },
    ],
  ])('rejects %s', (_name, overrides) => {
    expect(PlanDraft.safeParse({ ...planDraftFixture(), ...overrides }).success).toBe(false);
  });

  it('rejects a step carrying a repository', () => {
    const step = { ...planDraftFixture().steps[0], repositoryId: REPOSITORY_ID };
    const draft = { ...planDraftFixture(), steps: [step] };
    expect(PlanDraft.safeParse(draft).success).toBe(false);
  });
});
