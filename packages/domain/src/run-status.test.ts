import {
  type RunEventBody,
  RunEventType,
  type RunStatus,
  RunStatus as RunStatusEnum,
} from '@plangineer/contracts';
import { describe, expect, it } from 'vitest';
import { leaseLostOutcome, nextRunStatus } from './run-status.ts';

const RUNNER_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

/** One body per event type, with run.lease_lost in both its forms, keyed by a short name. */
const EVENTS: Record<string, RunEventBody> = {
  'run.queued': { type: 'run.queued' },
  'run.leased': { type: 'run.leased', runnerId: RUNNER_ID, attempt: 1 },
  'run.started': {
    type: 'run.started',
    commit: 'a'.repeat(40),
    cli: { name: 'claude-code', version: '2.1.284' },
  },
  'agent.session': { type: 'agent.session', model: 'm', cliVersion: '2.1.284', skills: [] },
  'agent.message': { type: 'agent.message', text: 'x', truncated: false, parentToolUseId: null },
  'agent.tool_use': {
    type: 'agent.tool_use',
    toolUseId: 't',
    name: 'Read',
    inputJson: '{}',
    truncated: false,
    parentToolUseId: null,
  },
  'agent.tool_result': {
    type: 'agent.tool_result',
    toolUseId: 't',
    isError: false,
    text: 'x',
    truncated: false,
  },
  'agent.rate_limit': { type: 'agent.rate_limit', status: 'allowed', resetsAt: null },
  'agent.other': { type: 'agent.other', vendorType: 'x', json: '{}', truncated: false },
  'run.cancel_requested': { type: 'run.cancel_requested' },
  'run.lease_lost requeued': { type: 'run.lease_lost', attempt: 1, requeued: true },
  'run.lease_lost kept': { type: 'run.lease_lost', attempt: 1, requeued: false },
  'setup.pushed': {
    type: 'setup.pushed',
    branch: 'plangineer/setup',
    commit: 'b'.repeat(40),
    changedPaths: ['.agents/skills/testing/SKILL.md'],
    changedPathCount: 1,
  },
  'run.succeeded': {
    type: 'run.succeeded',
    resultText: 'x',
    truncated: false,
    costUsd: null,
    durationMs: 1,
    numTurns: 1,
  },
  'run.failed': {
    type: 'run.failed',
    reason: 'exit_code',
    message: 'x',
    exitCode: 1,
    stderrTail: [],
  },
  'run.cancelled': { type: 'run.cancelled', reason: 'requested' },
};

const AGENT_EVENTS = [
  'agent.session',
  'agent.message',
  'agent.tool_use',
  'agent.tool_result',
  'agent.rate_limit',
  'agent.other',
];

/** Every allowed pair, as "status event" to the resulting status. Every other pair is rejected. */
const ALLOWED: Record<string, RunStatus> = {
  'queued run.leased': 'leased',
  'leased run.lease_lost requeued': 'queued',
  'queued run.cancelled': 'cancelled',
  'leased run.started': 'running',
  'leased run.failed': 'failed',
  'leased run.cancelled': 'cancelled',
  'running run.succeeded': 'succeeded',
  'running run.failed': 'failed',
  'running run.cancelled': 'cancelled',
  'queued run.queued': 'queued',
  'queued run.cancel_requested': 'queued',
  'leased run.cancel_requested': 'leased',
  'running run.cancel_requested': 'running',
  'leased run.lease_lost kept': 'leased',
  'running run.lease_lost kept': 'running',
  'running setup.pushed': 'running',
  ...Object.fromEntries(AGENT_EVENTS.map((type) => [`running ${type}`, 'running'])),
};

const PAIRS = RunStatusEnum.options.flatMap((status) =>
  Object.keys(EVENTS).map((name) => ({ status, name, key: `${status} ${name}` })),
);

describe('nextRunStatus', () => {
  it('has a body for every event type', () => {
    expect(new Set(Object.values(EVENTS).map((event) => event.type))).toEqual(
      new Set(RunEventType.options),
    );
  });

  it.each(PAIRS.filter(({ key }) => key in ALLOWED))(
    'allows $name on $status',
    ({ status, name, key }) => {
      expect(nextRunStatus(status, EVENTS[name]!)).toEqual({ ok: true, status: ALLOWED[key] });
    },
  );

  it.each(PAIRS.filter(({ key }) => !(key in ALLOWED)))(
    'rejects $name on $status',
    ({ status, name }) => {
      expect(nextRunStatus(status, EVENTS[name]!)).toEqual({ ok: false });
    },
  );
});

describe('leaseLostOutcome', () => {
  it.each([
    { status: 'leased', attempt: 1, cancelRequested: false, expected: 'requeue' },
    { status: 'leased', attempt: 2, cancelRequested: false, expected: 'requeue' },
    { status: 'leased', attempt: 3, cancelRequested: false, expected: 'fail' },
    { status: 'running', attempt: 1, cancelRequested: false, expected: 'fail' },
    { status: 'running', attempt: 3, cancelRequested: false, expected: 'fail' },
    { status: 'leased', attempt: 1, cancelRequested: true, expected: 'cancel' },
    { status: 'leased', attempt: 3, cancelRequested: true, expected: 'cancel' },
    { status: 'running', attempt: 1, cancelRequested: true, expected: 'cancel' },
  ] as const)(
    'a $status run at attempt $attempt of 3 with cancel $cancelRequested ends in $expected',
    ({ status, attempt, cancelRequested, expected }) => {
      const outcomes = {
        requeue: { status: 'queued', requeued: true, event: null },
        fail: { status: 'failed', requeued: false, event: 'run.failed' },
        cancel: { status: 'cancelled', requeued: false, event: 'run.cancelled' },
      };
      expect(leaseLostOutcome({ status, attempt, maxAttempts: 3, cancelRequested })).toEqual(
        outcomes[expected],
      );
    },
  );
});
