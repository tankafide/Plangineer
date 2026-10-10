import type { ReadinessItem, ReadinessKey } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { isReady, planReadiness, sectionStatuses } from './plan-readiness.ts';
import { planBodyFixture, stepFixture, uuid } from './test-fixtures.ts';

const counts = (items: ReadinessItem[]) =>
  Object.fromEntries(items.map((item) => [item.key, item.count]));

/** A body that fails every item once: a step with no file and no line, an unticked row, a stale row and a blocker. */
const unready = planBodyFixture({
  steps: [stepFixture(), stepFixture({ id: uuid(30), files: [], doneWhen: [] })],
  coverage: [
    { lineId: uuid(21), ticks: [], stale: false },
    { lineId: uuid(22), ticks: ['unit'], stale: true },
  ],
  blockers: [{ id: uuid(60), section: 'decisions', stepId: null, text: 'Pick a library.' }],
});

describe('planReadiness', () => {
  it('passes every item of a ready body with no open question', () => {
    const items = planReadiness(planBodyFixture(), 0);
    expect(items.map((item) => item.key)).toEqual([
      'open_questions',
      'step_files',
      'done_when',
      'coverage',
      'stale_rows',
      'blockers',
    ]);
    expect(items.every((item) => item.ok && item.count === 0)).toBe(true);
  });

  it('counts each of the six items', () => {
    expect(counts(planReadiness(unready, 2))).toEqual({
      open_questions: 2,
      step_files: 1,
      done_when: 1,
      coverage: 1,
      stale_rows: 1,
      blockers: 1,
    });
    expect(planReadiness(unready, 2).every((item) => !item.ok)).toBe(true);
  });

  it('fails every item but the open questions with no body', () => {
    expect(planReadiness(null, 0)).toEqual([
      { key: 'open_questions', ok: true, count: 0 },
      { key: 'step_files', ok: false, count: 0 },
      { key: 'done_when', ok: false, count: 0 },
      { key: 'coverage', ok: false, count: 0 },
      { key: 'stale_rows', ok: false, count: 0 },
      { key: 'blockers', ok: false, count: 0 },
    ]);
  });
});

describe('isReady', () => {
  it('is true when every item is ok', () => {
    expect(isReady(planReadiness(planBodyFixture(), 0))).toBe(true);
  });

  it('is false when one item fails', () => {
    expect(isReady(planReadiness(planBodyFixture(), 1))).toBe(false);
  });
});

const failing = (key: ReadinessKey): ReadinessItem[] =>
  planReadiness(planBodyFixture(), 0).map((item) =>
    item.key === key ? { key, ok: false, count: 1 } : item,
  );

const statusOf = (statuses: { section: string; status: string }[], section: string) =>
  statuses.find((entry) => entry.section === section)?.status;

describe('sectionStatuses', () => {
  it('marks every section complete for a ready body, in plan order, hiding empty constraints', () => {
    expect(sectionStatuses(planBodyFixture(), [], planReadiness(planBodyFixture(), 0))).toEqual([
      { section: 'goal', status: 'complete' },
      { section: 'prerequisites', status: 'complete' },
      { section: 'steps', status: 'complete' },
      { section: 'decisions', status: 'complete' },
      { section: 'test_plan', status: 'complete' },
      { section: 'verification', status: 'complete' },
    ]);
  });

  it('shows constraints when the body has some', () => {
    const body = planBodyFixture({
      constraints: [{ id: uuid(50), title: 'Size', target: 'Small', check: 'A test' }],
      coverage: [
        ...planBodyFixture().coverage,
        { lineId: uuid(50), ticks: ['unit'], stale: false },
      ],
    });
    const statuses = sectionStatuses(body, [], planReadiness(body, 0));
    expect(statusOf(statuses, 'constraints')).toBe('complete');
  });

  it.each([
    ['step_files', 'steps'],
    ['done_when', 'steps'],
    ['coverage', 'test_plan'],
    ['stale_rows', 'test_plan'],
  ] as const)('maps a failing %s item to %s', (key, section) => {
    const statuses = sectionStatuses(planBodyFixture(), [], failing(key));
    expect(statuses.filter((entry) => entry.status === 'needs_work')).toEqual([
      { section, status: 'needs_work' },
    ]);
  });

  it("maps failing blockers to each blocker's own section", () => {
    const body = planBodyFixture({
      blockers: [
        { id: uuid(60), section: 'goal', stepId: null, text: 'Name the audience.' },
        { id: uuid(61), section: 'verification', stepId: null, text: 'Name the check.' },
      ],
    });
    const statuses = sectionStatuses(body, [], planReadiness(body, 0));
    expect(statuses.filter((entry) => entry.status === 'needs_work')).toEqual([
      { section: 'goal', status: 'needs_work' },
      { section: 'verification', status: 'needs_work' },
    ]);
  });

  it('maps a failing open questions item to no section', () => {
    const statuses = sectionStatuses(planBodyFixture(), [], failing('open_questions'));
    expect(statuses.every((entry) => entry.status === 'complete')).toBe(true);
  });

  it('marks each section an open question names, before needs work', () => {
    const statuses = sectionStatuses(planBodyFixture(), ['steps', 'goal'], failing('step_files'));
    expect(statusOf(statuses, 'goal')).toBe('open_question');
    expect(statusOf(statuses, 'steps')).toBe('open_question');
    expect(statusOf(statuses, 'decisions')).toBe('complete');
  });

  it('hides constraints and marks steps and the test plan with no body yet', () => {
    expect(sectionStatuses(null, ['decisions'], planReadiness(null, 1))).toEqual([
      { section: 'goal', status: 'complete' },
      { section: 'prerequisites', status: 'complete' },
      { section: 'steps', status: 'needs_work' },
      { section: 'decisions', status: 'open_question' },
      { section: 'test_plan', status: 'needs_work' },
      { section: 'verification', status: 'complete' },
    ]);
  });
});
