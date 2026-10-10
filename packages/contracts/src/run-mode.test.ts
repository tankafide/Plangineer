import { describe, expect, it } from 'vitest';
import { RunMode, WorkflowSettings } from './run-mode.ts';

const ASK = { findings: 'ask', rounds: { mode: 'ask' } };
const MANUAL = {
  decisions: 'ask',
  planCheckIn: 'pause',
  planReview: ASK,
  implementationReview: ASK,
};

const settings = (implementationReview: unknown) => ({ ...MANUAL, implementationReview });

describe('RunMode', () => {
  it('rejects an unknown mode', () => {
    expect(RunMode.safeParse('auto').success).toBe(false);
  });
});

describe('WorkflowSettings', () => {
  it.each([
    MANUAL,
    { ...MANUAL, decisions: 'recommended' },
    settings({ findings: 'fix_all', rounds: { mode: 'fixed', count: 5 } }),
    settings({ findings: 'ask', rounds: { mode: 'adaptive', max: 1 } }),
  ])('accepts %o', (value) => {
    expect(WorkflowSettings.safeParse(value).success).toBe(true);
  });

  it.each([
    settings({ findings: 'ask', rounds: { mode: 'fixed', count: 6 } }),
    settings({ findings: 'ask', rounds: { mode: 'adaptive', max: 0 } }),
    settings({ findings: 'ask', rounds: { mode: 'ask', count: 2 } }),
    settings({ findings: 'auto', rounds: { mode: 'ask' } }),
    { ...MANUAL, planCheckIn: 'always' },
    { ...MANUAL, decisions: 'guess' },
    { planCheckIn: 'pause', planReview: ASK, implementationReview: ASK },
  ])('rejects %o', (value) => {
    expect(WorkflowSettings.safeParse(value).success).toBe(false);
  });
});
