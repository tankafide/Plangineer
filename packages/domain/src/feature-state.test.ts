import { describe, expect, it } from 'vitest';
import { FeatureState } from '@plangineer/contracts';
import { featureStateAfterTasks, planOpen, startPlanning } from './feature-state.ts';

describe('featureStateAfterTasks', () => {
  it('moves pre_planning to plan_ready once every task run has ended', () => {
    expect(featureStateAfterTasks('pre_planning', ['succeeded', 'succeeded'])).toBe('plan_ready');
  });

  it('counts a failed or cancelled task as finished', () => {
    expect(featureStateAfterTasks('pre_planning', ['succeeded', 'failed', 'cancelled'])).toBe(
      'plan_ready',
    );
  });

  it.each(['queued', 'leased', 'running'] as const)('waits while a task run is %s', (status) => {
    expect(featureStateAfterTasks('pre_planning', ['succeeded', status])).toBe('pre_planning');
  });

  it.each(['plan_ready', 'planning', 'ready_for_review'] as const)(
    'leaves %s unchanged',
    (state) => {
      expect(featureStateAfterTasks(state, ['succeeded'])).toBe(state);
      expect(featureStateAfterTasks(state, ['running'])).toBe(state);
    },
  );
});

describe('startPlanning', () => {
  it.each([
    ['pre_planning', 'manual'],
    ['pre_planning', 'manual_plan'],
    ['plan_ready', 'manual'],
    ['plan_ready', 'manual_plan'],
  ] as const)('allows %s under %s', (state, runMode) => {
    expect(startPlanning(state, runMode)).toEqual({ ok: true, state: 'planning' });
  });

  it.each(['pre_planning', 'plan_ready'] as const)('refuses %s under Auto loop', (state) => {
    expect(startPlanning(state, 'auto_loop')).toEqual({ ok: false, reason: 'auto_loop' });
  });

  it.each([
    ['planning', 'manual'],
    ['planning', 'manual_plan'],
    ['planning', 'auto_loop'],
    ['ready_for_review', 'manual'],
    ['ready_for_review', 'manual_plan'],
    ['ready_for_review', 'auto_loop'],
  ] as const)('refuses a feature in %s under %s as already planning', (state, runMode) => {
    expect(startPlanning(state, runMode)).toEqual({ ok: false, reason: 'already_planning' });
  });
});

describe('planOpen', () => {
  const OPEN = new Set<FeatureState>(['planning', 'ready_for_review']);

  it.each(FeatureState.options)('is open only while planning or ready for review: %s', (state) => {
    expect(planOpen(state)).toBe(OPEN.has(state));
  });
});
