import type { PlanBody, PlanStep } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { alignCoverage, markStale } from './plan-coverage.ts';
import { planBodyFixture, stepFixture, uuid } from './test-fixtures.ts';

const constraint = { id: uuid(50), title: 'Size', target: 'Under 5 MB', check: 'A unit test' };

describe('alignCoverage', () => {
  it('leaves an aligned body as it is', () => {
    expect(alignCoverage(planBodyFixture())).toEqual(planBodyFixture());
  });

  it('adds an empty row for a new line and a constraint, in plan order', () => {
    const body = planBodyFixture({
      steps: [
        stepFixture({ doneWhen: [...stepFixture().doneWhen, { id: uuid(23), text: 'New.' }] }),
      ],
      constraints: [constraint],
      coverage: [{ lineId: uuid(22), ticks: ['unit'], stale: true }],
    });
    expect(alignCoverage(body).coverage).toEqual([
      { lineId: uuid(21), ticks: [], stale: false },
      { lineId: uuid(22), ticks: ['unit'], stale: true },
      { lineId: uuid(23), ticks: [], stale: false },
      { lineId: uuid(50), ticks: [], stale: false },
    ]);
  });

  it('drops a row for a removed line and a repeated row', () => {
    const body = planBodyFixture({
      steps: [stepFixture()],
      coverage: [
        { lineId: uuid(21), ticks: ['unit'], stale: false },
        { lineId: uuid(21), ticks: ['component'], stale: false },
        { lineId: uuid(22), ticks: [], stale: false },
        { lineId: uuid(31), ticks: ['unit'], stale: false },
      ],
    });
    expect(alignCoverage(body).coverage).toEqual([
      { lineId: uuid(21), ticks: ['unit'], stale: false },
      { lineId: uuid(22), ticks: [], stale: false },
    ]);
  });
});

const withFirstStep = (body: PlanBody, step: Partial<PlanStep>): PlanBody => ({
  ...body,
  steps: body.steps.map((candidate, index) =>
    index === 0 ? { ...candidate, ...step } : candidate,
  ),
});

const staleFlags = (body: PlanBody) => body.coverage.map((row) => row.stale);

describe('markStale', () => {
  const previous = planBodyFixture();

  it.each([
    ['title', { title: 'Render the PDF on the server' }],
    ['files', { files: ['apps/api/src/pdf.ts', 'apps/api/src/fonts.ts'] }],
    ['body', { body: 'Render the plan with a new library.' }],
    [
      'done-when texts',
      {
        doneWhen: [
          { id: uuid(21), text: 'A plan renders as a PDF.' },
          { id: uuid(22), text: 'An empty plan renders a blank page.' },
        ],
      },
    ],
  ])('flags the rows of a step whose %s changed, and leaves other rows alone', (_name, step) => {
    expect(staleFlags(markStale(previous, withFirstStep(previous, step)))).toEqual([
      true,
      true,
      false,
    ]);
  });

  it('flags nothing when no step changed', () => {
    expect(staleFlags(markStale(previous, planBodyFixture({ goal: 'A new goal.' })))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it('keeps a row the engineer cleared cleared when its step did not change', () => {
    const cleared = planBodyFixture();
    const stale = planBodyFixture({
      coverage: cleared.coverage.map((row) => ({ ...row, stale: true })),
    });
    expect(staleFlags(markStale(stale, cleared))).toEqual([false, false, false]);
  });

  it('keeps a stale row stale when its step did not change', () => {
    const stale = planBodyFixture({
      coverage: previous.coverage.map((row) => ({ ...row, stale: row.lineId === uuid(31) })),
    });
    expect(staleFlags(markStale(previous, stale))).toEqual([false, false, true]);
  });

  it('leaves the rows of a new step alone', () => {
    const next = planBodyFixture({
      steps: [
        ...previous.steps,
        stepFixture({ id: uuid(70), doneWhen: [{ id: uuid(71), text: 'X.' }] }),
      ],
      coverage: [...previous.coverage, { lineId: uuid(71), ticks: [], stale: false }],
    });
    expect(staleFlags(markStale(previous, next))).toEqual([false, false, false, false]);
  });

  it('changes nothing with no previous body', () => {
    expect(markStale(null, previous)).toEqual(previous);
  });
});
