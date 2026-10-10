import { describe, expect, it } from 'vitest';
import { jsonByteLength } from './json-bytes.ts';
import { SETUP_INPUTS_MAX, SETUP_JOB_MAX_BYTES } from './repository-setup.ts';
import { TASK_INPUTS_MAX } from './feature.ts';
import {
  PlanningJob,
  PrePlanningJob,
  RunJob,
  runnerAttachmentPath,
  runnerPlanningInputsPath,
  RunnerToServerMessage,
  SETUP_FILE_CONTENT_MAX,
  ServerToRunnerMessage,
} from './runner-protocol.ts';

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
    { type: 'runner.clis', clis: hello().clis },
  ])('accepts a valid $type', (message) => {
    expect(RunnerToServerMessage.safeParse(message).success).toBe(true);
  });

  it('rejects runner.clis with more than 4 CLIs or an unknown key', () => {
    const clis = hello().clis;
    expect(
      RunnerToServerMessage.safeParse({ type: 'runner.clis', clis: Array(5).fill(clis[0]) })
        .success,
    ).toBe(false);
    expect(RunnerToServerMessage.safeParse({ type: 'runner.clis', clis, extra: 1 }).success).toBe(
      false,
    );
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
    kind: 'test',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'List the files.',
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
    { type: 'run.assign', runId: RUN_ID, attempt: 1, job: { ...job, kind: 'plan' } },
    { type: 'run.ack', runId: RUN_ID, attempt: 1, seq: -1 },
    { type: 'run.cancel', runId: RUN_ID, attempt: 1, reason: 'x' },
  ])('rejects the invalid message %#', (message) => {
    expect(ServerToRunnerMessage.safeParse(message).success).toBe(false);
  });
});

function setupJob(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'setup',
    repository: { owner: 'acme', name: 'app' },
    commit: 'a'.repeat(40),
    defaultBranch: 'main',
    prompt: 'Finish the skills.',
    inputs: '# Inputs',
    files: [{ path: '.agents/skills/testing/SKILL.md', content: '# Testing' }],
    moveSkills: ['legacy'],
    templateSkills: ['testing'],
    generateSkills: ['backend'],
    ...overrides,
  };
}

const file = (index: number, content = '') => ({
  path: `.agents/skills/skill-${index}/SKILL.md`,
  content,
});

describe('RunJob', () => {
  const testJob = {
    kind: 'test',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'List the files.',
  };

  it('parses a test job and a setup job', () => {
    expect(RunJob.parse(testJob)).toEqual(testJob);
    expect(RunJob.parse(setupJob())).toEqual(setupJob());
  });

  it('rejects a setup job with 65 files', () => {
    const files = Array.from({ length: 65 }, (_, index) => file(index));
    expect(RunJob.safeParse(setupJob({ files })).success).toBe(false);
  });

  it('rejects a setup job whose UTF-8 JSON is over the byte cap', () => {
    // Each é is one character and two UTF-8 bytes, so the files fit by length and not by bytes.
    const content = 'é'.repeat(SETUP_FILE_CONTENT_MAX);
    const files = Array.from({ length: 8 }, (_, index) => file(index, content));
    const job = setupJob({ files });
    expect(JSON.stringify(job).length).toBeLessThan(SETUP_JOB_MAX_BYTES);
    expect(jsonByteLength(job)).toBeGreaterThan(SETUP_JOB_MAX_BYTES);
    expect(RunJob.safeParse(job).success).toBe(false);
  });

  it.each([
    ['a file outside .agents/skills', { files: [{ path: 'README.md', content: '' }] }],
    ['a file path with ..', { files: [{ path: '.agents/skills/a/../b/SKILL.md', content: '' }] }],
    ['a skill name with a capital', { generateSkills: ['Backend'] }],
    ['a short commit', { commit: 'abc' }],
    ['inputs over the cap', { inputs: 'x'.repeat(SETUP_INPUTS_MAX + 1) }],
    ['an unknown key', { permissionMode: 'plan' }],
  ])('rejects a setup job with %s', (_, overrides) => {
    expect(RunJob.safeParse(setupJob(overrides)).success).toBe(false);
  });
});

const ATTACHMENT = {
  id: RUN_ID,
  name: 'screen.png',
  mediaType: 'image/png',
  sizeBytes: 12,
};

function prePlanningJob(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'pre_planning',
    task: 'intake',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'Write the feature brief.',
    inputs: '## Description',
    attachments: [ATTACHMENT],
    ...overrides,
  };
}

describe('PrePlanningJob', () => {
  it.each([
    prePlanningJob(),
    prePlanningJob({ task: 'exploration', attachments: [] }),
    prePlanningJob({ task: 'research', attachments: [] }),
  ])('accepts a $task job', (job) => {
    expect(RunJob.parse(job)).toEqual(job);
  });

  it('rejects inputs over TASK_INPUTS_MAX', () => {
    const inputs = 'x'.repeat(TASK_INPUTS_MAX + 1);
    expect(PrePlanningJob.safeParse(prePlanningJob({ inputs })).success).toBe(false);
  });

  it.each(['research', 'exploration'])('rejects a %s job with an attachment', (task) => {
    expect(PrePlanningJob.safeParse(prePlanningJob({ task })).success).toBe(false);
  });
});

const ASK = { findings: 'ask', rounds: { mode: 'ask' } };

function planningJob(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'planning',
    turn: 'guided',
    section: null,
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'Run one planning turn.',
    settings: {
      decisions: 'ask',
      planCheckIn: 'pause',
      planReview: ASK,
      implementationReview: ASK,
    },
    ...overrides,
  };
}

describe('PlanningJob', () => {
  it.each([
    ['a guided turn on a branch', planningJob()],
    ['a guided turn on a 40-character commit', planningJob({ ref: 'a'.repeat(40) })],
    ['a section action', planningJob({ turn: 'section_action', section: 'goal' })],
    ['a step revision', planningJob({ turn: 'revise_step' })],
  ])('accepts %s', (_name, job) => {
    expect(RunJob.parse(job)).toEqual(job);
  });

  it.each([
    ['a section action with no section', { turn: 'section_action', section: null }],
    ['a guided turn with a section', { section: 'goal' }],
    ['a step revision with a section', { turn: 'revise_step', section: 'steps' }],
    ['an unknown key', { inputs: '# Planning inputs' }],
  ])('rejects %s', (_name, overrides) => {
    expect(PlanningJob.safeParse(planningJob(overrides)).success).toBe(false);
  });
});

describe('runner download paths', () => {
  it('fill in the attachment id and the run id', () => {
    expect(runnerAttachmentPath(RUN_ID)).toBe(`/api/runners/attachments/${RUN_ID}`);
    expect(runnerPlanningInputsPath(RUN_ID)).toBe(`/api/runners/planning-inputs/${RUN_ID}`);
  });
});
