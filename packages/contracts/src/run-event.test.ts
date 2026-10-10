import { describe, expect, it } from 'vitest';
import {
  AGENT_NAME_MAX,
  AGENT_TEXT_MAX,
  FAILURE_MESSAGE_MAX,
  RunEvent,
  RunEventBody,
  RunEventType,
  RunnerRunEventBody,
  runEventsPath,
  SETUP_PUSHED_PATHS_MAX,
  SETUP_PUSHED_PATHS_MAX_BYTES,
  SKILL_NAME_MAX,
  SKILLS_MAX,
  STDERR_LINE_MAX,
  STDERR_TAIL_LINES,
} from './run-event.ts';
import { MAX_EVENTS_MESSAGE_BYTES } from './runner-protocol.ts';

const RUN_ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';
const COMMIT = 'a'.repeat(40);

/** A string of the given length in which JSON escapes every character as \u0001. */
const escaped = (length: number) => '\u0001'.repeat(length);

/** One valid body per event type. */
const VALID_BODIES = [
  { type: 'run.queued' },
  { type: 'run.leased', runnerId: RUN_ID, attempt: 1 },
  { type: 'run.started', commit: COMMIT, cli: { name: 'claude-code', version: '2.1.284' } },
  { type: 'agent.session', model: 'claude-opus', cliVersion: '2.1.284', skills: ['testing'] },
  { type: 'agent.message', text: 'Hello', truncated: false, parentToolUseId: null },
  {
    type: 'agent.tool_use',
    toolUseId: 'toolu_1',
    name: 'Read',
    inputJson: '{}',
    truncated: false,
    parentToolUseId: null,
  },
  { type: 'agent.tool_result', toolUseId: 'toolu_1', isError: false, text: 'ok', truncated: false },
  { type: 'agent.rate_limit', status: 'allowed', resetsAt: AT },
  { type: 'agent.other', vendorType: 'system/hook', json: '{}', truncated: false },
  { type: 'run.cancel_requested' },
  { type: 'run.lease_lost', attempt: 1, requeued: true },
  {
    type: 'setup.pushed',
    branch: 'plangineer/setup',
    commit: COMMIT,
    changedPaths: ['.agents/skills/testing/SKILL.md'],
    changedPathCount: 1,
  },
  { type: 'planning.output', output: { kind: 'section', patch: { section: 'goal', goal: 'G' } } },
  {
    type: 'run.succeeded',
    resultText: 'done',
    truncated: false,
    costUsd: 0.01,
    durationMs: 1200,
    numTurns: 2,
  },
  { type: 'run.failed', reason: 'exit_code', message: 'Exited 2', exitCode: 2, stderrTail: ['x'] },
  { type: 'run.cancelled', reason: 'requested' },
] as const;

/** As many fully escaped 300-character paths as the byte cap allows. */
function largestPaths(): string[] {
  const paths: string[] = [];
  while (JSON.stringify([...paths, escaped(300)]).length <= SETUP_PUSHED_PATHS_MAX_BYTES) {
    paths.push(escaped(300));
  }
  return paths;
}

/** Each runner-sent body with every string at its bound and every character escaped. */
const LARGEST_RUNNER_BODIES = [
  { type: 'run.started', commit: COMMIT, cli: { name: 'claude-code', version: escaped(50) } },
  {
    type: 'agent.session',
    model: escaped(AGENT_NAME_MAX),
    cliVersion: escaped(50),
    skills: Array.from({ length: SKILLS_MAX }, () => escaped(SKILL_NAME_MAX)),
  },
  {
    type: 'agent.message',
    text: escaped(AGENT_TEXT_MAX),
    truncated: true,
    parentToolUseId: escaped(AGENT_NAME_MAX),
  },
  {
    type: 'agent.tool_use',
    toolUseId: escaped(AGENT_NAME_MAX),
    name: escaped(AGENT_NAME_MAX),
    inputJson: escaped(AGENT_TEXT_MAX),
    truncated: true,
    parentToolUseId: escaped(AGENT_NAME_MAX),
  },
  {
    type: 'agent.tool_result',
    toolUseId: escaped(AGENT_NAME_MAX),
    isError: true,
    text: escaped(AGENT_TEXT_MAX),
    truncated: true,
  },
  { type: 'agent.other', vendorType: escaped(100), json: escaped(AGENT_TEXT_MAX), truncated: true },
  {
    type: 'setup.pushed',
    branch: 'plangineer/setup',
    commit: COMMIT,
    changedPaths: largestPaths(),
    changedPathCount: Number.MAX_SAFE_INTEGER,
  },
  {
    type: 'run.succeeded',
    resultText: escaped(AGENT_TEXT_MAX),
    truncated: true,
    costUsd: Number.MAX_VALUE,
    durationMs: Number.MAX_SAFE_INTEGER,
    numTurns: Number.MAX_SAFE_INTEGER,
  },
  {
    type: 'run.failed',
    reason: 'event_buffer_full',
    message: escaped(FAILURE_MESSAGE_MAX),
    exitCode: Number.MIN_SAFE_INTEGER,
    stderrTail: Array.from({ length: STDERR_TAIL_LINES }, () => escaped(STDERR_LINE_MAX)),
  },
];

describe('RunEventBody', () => {
  it('has one variant per RunEventType', () => {
    expect(VALID_BODIES.map((body) => body.type)).toEqual(RunEventType.options);
  });

  it.each(VALID_BODIES)('accepts a valid $type', (body) => {
    expect(RunEventBody.parse(body)).toEqual(body);
  });

  it.each(VALID_BODIES)('rejects $type with an unknown key', (body) => {
    expect(RunEventBody.safeParse({ ...body, extra: true }).success).toBe(false);
  });

  it.each([
    { type: 'run.started', commit: 'abc', cli: { name: 'claude-code', version: '2.1.284' } },
    { type: 'agent.message', text: 'x'.repeat(65_537), truncated: true, parentToolUseId: null },
    { type: 'agent.session', model: 'm', cliVersion: '2', skills: ['x'.repeat(101)] },
    { type: 'agent.session', model: 'm', cliVersion: '2', skills: Array(501).fill('s') },
    { type: 'agent.rate_limit', status: 'blocked', resetsAt: null },
    { type: 'run.failed', reason: 'unknown', message: 'x', exitCode: null, stderrTail: [] },
    { type: 'run.failed', reason: 'timeout', message: '', exitCode: null, stderrTail: [] },
    {
      type: 'run.failed',
      reason: 'timeout',
      message: 'x',
      exitCode: null,
      stderrTail: Array(21).fill(''),
    },
    { type: 'run.cancelled', reason: 'bored' },
    { type: 'run.leased', runnerId: RUN_ID, attempt: 0 },
    { type: 'run.unknown' },
  ])('rejects the invalid body %#', (body) => {
    expect(RunEventBody.safeParse(body).success).toBe(false);
  });

  it.each(LARGEST_RUNNER_BODIES)('accepts the largest $type', (body) => {
    expect(RunEventBody.safeParse(body).success).toBe(true);
  });

  it.each(LARGEST_RUNNER_BODIES)(
    'serializes the largest $type, fully escaped, to under 512 KiB',
    (body) => {
      const entry = JSON.stringify({ seq: Number.MAX_SAFE_INTEGER, event: body });
      expect(Buffer.byteLength(entry)).toBeLessThan(MAX_EVENTS_MESSAGE_BYTES);
    },
  );
});

describe('RunnerRunEventBody', () => {
  it.each(['run.queued', 'run.leased', 'run.cancel_requested', 'run.lease_lost'])(
    'rejects the API-only %s',
    (type) => {
      const body = VALID_BODIES.find((candidate) => candidate.type === type);
      expect(RunnerRunEventBody.safeParse(body).success).toBe(false);
    },
  );

  it('accepts a runner event', () => {
    expect(RunnerRunEventBody.safeParse(VALID_BODIES[4]).success).toBe(true);
  });

  it('accepts a planning.output event', () => {
    const body = VALID_BODIES.find((candidate) => candidate.type === 'planning.output');
    expect(RunnerRunEventBody.parse(body)).toEqual(body);
  });

  it('accepts a run.failed for planning inputs that failed to download', () => {
    const body = {
      type: 'run.failed',
      reason: 'inputs_failed',
      message: 'The planning inputs answered 404.',
      exitCode: null,
      stderrTail: [],
    };
    expect(RunnerRunEventBody.safeParse(body).success).toBe(true);
  });

  it('rejects a planning.output event whose output is invalid', () => {
    const body = { type: 'planning.output', output: { kind: 'questions', questions: [] } };
    expect(RunnerRunEventBody.safeParse(body).success).toBe(false);
  });
});

const pushed = (overrides: Record<string, unknown>) => ({ ...VALID_BODIES[11], ...overrides });

describe('setup.pushed', () => {
  it('accepts 1,000 paths of 300 characters', () => {
    const changedPaths = Array.from({ length: SETUP_PUSHED_PATHS_MAX }, (_, index) =>
      `${index}`.padEnd(300, 'x'),
    );
    const body = pushed({ changedPaths, changedPathCount: 1_000 });
    expect(RunnerRunEventBody.safeParse(body).success).toBe(true);
    const entry = JSON.stringify({ seq: Number.MAX_SAFE_INTEGER, event: body });
    expect(Buffer.byteLength(entry)).toBeLessThan(MAX_EVENTS_MESSAGE_BYTES);
  });

  it.each([
    ['another branch', { branch: 'main' }],
    ['1,001 paths', { changedPaths: Array(1_001).fill('a') }],
    ['a path of 301 characters', { changedPaths: ['a'.repeat(301)] }],
    ['paths over the byte cap', { changedPaths: largestPaths().concat(escaped(300)) }],
    ['a short commit', { commit: 'abc' }],
  ])('rejects %s', (_, overrides) => {
    expect(RunnerRunEventBody.safeParse(pushed(overrides)).success).toBe(false);
  });
});

describe('RunEvent', () => {
  it('accepts a body with its event id, run id and time', () => {
    const event = { ...VALID_BODIES[1], id: 1, runId: RUN_ID, at: AT };
    expect(RunEvent.parse(event)).toEqual(event);
  });

  it.each([
    { id: 0, runId: RUN_ID, at: AT },
    { id: 1, runId: 'run-1', at: AT },
    { id: 1, runId: RUN_ID, at: '2026-10-07' },
  ])('rejects an invalid envelope %#', (envelope) => {
    expect(RunEvent.safeParse({ type: 'run.queued', ...envelope }).success).toBe(false);
  });

  it('rejects a body with no envelope', () => {
    expect(RunEvent.safeParse({ type: 'run.queued' }).success).toBe(false);
  });
});

describe('runEventsPath', () => {
  it('fills the run id', () => {
    expect(runEventsPath(RUN_ID)).toBe(`/api/runs/${RUN_ID}/events`);
  });
});
