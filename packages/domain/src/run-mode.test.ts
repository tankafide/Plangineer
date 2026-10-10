import { describe, expect, it } from 'vitest';
import { workflowSettingsFor } from './run-mode.ts';

const ASK = { findings: 'ask', rounds: { mode: 'ask' } };
const FIX = { findings: 'fix_all', rounds: { mode: 'fixed', count: 2 } };

describe('workflowSettingsFor', () => {
  it.each([
    [
      'manual',
      { decisions: 'ask', planCheckIn: 'pause', planReview: ASK, implementationReview: ASK },
    ],
    [
      'manual_plan',
      { decisions: 'ask', planCheckIn: 'pause', planReview: ASK, implementationReview: FIX },
    ],
    [
      'auto_loop',
      { decisions: 'recommended', planCheckIn: 'skip', planReview: FIX, implementationReview: FIX },
    ],
  ] as const)('returns the %s settings', (runMode, settings) => {
    expect(workflowSettingsFor(runMode)).toEqual(settings);
  });
});
