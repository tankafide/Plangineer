import { PlanBody } from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { planBodyFixture } from '@/test/plan-fixtures';
import { clearStale, moveStep, replaceStepBody, setCoverageTicks } from './plan-edits';

describe('moveStep', () => {
  it('moves a step down past its neighbour', () => {
    const body = planBodyFixture();

    const moved = moveStep(body, 0, 1);

    expect(moved.steps.map((step) => step.title)).toEqual(['Step 2', 'Step 1']);
  });

  it('refuses a move past the last step', () => {
    expect(() => moveStep(planBodyFixture(), 1, 2)).toThrow('Cannot move step 1 to 2');
  });
});

describe('replaceStepBody', () => {
  it('gives a new line an id and a coverage row, and drops the row of a removed line', () => {
    const body = planBodyFixture();
    const [first] = body.steps;
    if (first === undefined) throw new Error('The fixture has no step');

    const edited = replaceStepBody(body, first.id, {
      title: 'Step one',
      files: ['src/one.ts'],
      body: 'Do it.',
      doneWhen: [{ id: null, text: 'It works now.' }],
    });

    const [line] = edited.steps[0]?.doneWhen ?? [];
    expect(line?.text).toBe('It works now.');
    expect(edited.coverage.map((row) => row.lineId)).toEqual([line?.id, body.coverage[1]?.lineId]);
    expect(PlanBody.safeParse(edited).success).toBe(true);
  });
});

describe('setCoverageTicks', () => {
  it('keeps the ticks in column order', () => {
    const body = planBodyFixture();
    const lineId = body.coverage[0]?.lineId ?? '';

    const ticked = setCoverageTicks(body, lineId, ['human_check', 'unit']);

    expect(ticked.coverage[0]?.ticks).toEqual(['unit', 'human_check']);
  });
});

describe('clearStale', () => {
  it('clears the stale flag of one row only', () => {
    const body = planBodyFixture({
      coverage: planBodyFixture().coverage.map((row) => ({ ...row, stale: true })),
    });
    const lineId = body.coverage[0]?.lineId ?? '';

    const cleared = clearStale(body, lineId);

    expect(cleared.coverage.map((row) => row.stale)).toEqual([false, true]);
  });
});
