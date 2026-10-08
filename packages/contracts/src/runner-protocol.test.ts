import { describe, expect, it } from 'vitest';
import { RunnerToServerMessage, ServerToRunnerMessage } from './runner-protocol.ts';

const RUN_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const MESSAGE = { type: 'agent.message', text: 'hi', truncated: false, parentToolUseId: null };

function hello(overrides: Record<string, unknown> = {}) {
  return {
    type: 'hello',
    runnerVersion: '0.0.0',
    platform: 'linux',
    concurrencyLimit: 2,
    clis: [{ name: 'claude-code', version: '2.1.284', available: true, minimumVersion: '2.1.284' }],
    activeRuns: [{ runId: RUN_ID, attempt: 1 }],
    ...overrides,
  };
}

function runEvents(events: unknown[], overrides: Record<string, unknown> = {}) {
  return { type: 'run.events', runId: RUN_ID, attempt: 1, events, ...overrides };
}

const entries = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ seq: index + 1, event: MESSAGE }));

describe('RunnerToServerMessage', () => {
  it.each([
    hello(),
    runEvents(entries(100)),
    { type: 'run.heartbeat', runId: RUN_ID, attempt: 1 },
    { type: 'runner.status', planLimitResetsAt: null },
    { type: 'runner.status', planLimitResetsAt: '2026-10-07T12:00:00.000Z' },
  ])('accepts a valid $type', (message) => {
    expect(RunnerToServerMessage.safeParse(message).success).toBe(true);
  });

  it('rejects run.events carrying an API-only event type', () => {
    const leased = { type: 'run.leased', runnerId: RUN_ID, attempt: 1 };
    expect(RunnerToServerMessage.safeParse(runEvents([{ seq: 1, event: leased }])).success).toBe(
      false,
    );
  });

  it('rejects run.events with an unknown key', () => {
    expect(RunnerToServerMessage.safeParse(runEvents(entries(1), { extra: 1 })).success).toBe(
      false,
    );
  });

  it('rejects run.events with 101 entries', () => {
    expect(RunnerToServerMessage.safeParse(runEvents(entries(101))).success).toBe(false);
  });

  it('rejects run.events with no entries', () => {
    expect(RunnerToServerMessage.safeParse(runEvents([])).success).toBe(false);
  });

  it.each([
    [
      [
        { seq: 2, event: MESSAGE },
        { seq: 1, event: MESSAGE },
      ],
    ],
    [
      [
        { seq: 1, event: MESSAGE },
        { seq: 1, event: MESSAGE },
      ],
    ],
    [[{ seq: 0, event: MESSAGE }]],
  ])('rejects run.events whose seq does not increase from 1: %j', (events) => {
    expect(RunnerToServerMessage.safeParse(runEvents(events)).success).toBe(false);
  });

  it('rejects a hello with 17 active runs', () => {
    const activeRuns = Array.from({ length: 17 }, () => ({ runId: RUN_ID, attempt: 1 }));
    expect(RunnerToServerMessage.safeParse(hello({ activeRuns })).success).toBe(false);
  });

  it.each([
    ['concurrencyLimit', 0],
    ['concurrencyLimit', 17],
    ['runnerVersion', ''],
    ['platform', 'aix'],
    ['extra', true],
  ])('rejects a hello with an invalid %s', (key, value) => {
    expect(RunnerToServerMessage.safeParse(hello({ [key]: value })).success).toBe(false);
  });

  it('rejects a run message with attempt 0', () => {
    const heartbeat = { type: 'run.heartbeat', runId: RUN_ID, attempt: 0 };
    expect(RunnerToServerMessage.safeParse(heartbeat).success).toBe(false);
  });
});

describe('ServerToRunnerMessage', () => {
  const job = {
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'List the files.',
    permissionMode: 'plan',
  };

  it.each([
    { type: 'welcome', runnerId: RUN_ID, heartbeatIntervalMs: 10_000, runs: [] },
    {
      type: 'welcome',
      runnerId: RUN_ID,
      heartbeatIntervalMs: 10_000,
      runs: [{ runId: RUN_ID, attempt: 1, valid: true, ackedSeq: 0 }],
    },
    { type: 'run.assign', runId: RUN_ID, attempt: 1, job },
    { type: 'run.cancel', runId: RUN_ID, attempt: 1 },
    { type: 'run.ack', runId: RUN_ID, attempt: 1, seq: 4 },
    { type: 'run.heartbeat_reply', runId: RUN_ID, attempt: 1, valid: true, cancelRequested: false },
  ])('accepts a valid $type', (message) => {
    expect(ServerToRunnerMessage.safeParse(message).success).toBe(true);
  });

  it.each([
    { type: 'run.assign', runId: RUN_ID, attempt: 1, job: { ...job, ref: '-x' } },
    { type: 'run.assign', runId: RUN_ID, attempt: 1, job: { ...job, permissionMode: 'auto' } },
    { type: 'run.ack', runId: RUN_ID, attempt: 1, seq: -1 },
    { type: 'run.cancel', runId: RUN_ID, attempt: 1, reason: 'x' },
  ])('rejects the invalid message %#', (message) => {
    expect(ServerToRunnerMessage.safeParse(message).success).toBe(false);
  });
});
