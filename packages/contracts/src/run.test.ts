import { describe, expect, it } from 'vitest';
import { GitRef, Repository, Run, RunCreateInput, RunSummary } from './run.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-07T12:00:00.000Z';

function createInput(overrides: Record<string, unknown> = {}) {
  return {
    runnerId: ID,
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    prompt: 'List the files.',
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: 'queued',
    repository: { owner: 'acme', name: 'app' },
    ref: 'main',
    attempt: 0,
    cancelRequested: false,
    createdAt: AT,
    startedAt: null,
    endedAt: null,
    commit: null,
    runner: { id: ID, name: 'workstation', online: true, lastSeenAt: AT, planLimitResetsAt: null },
    ...overrides,
  };
}

const run = (overrides: Record<string, unknown> = {}) =>
  summary({ prompt: 'List the files.', ...overrides });

describe('Repository', () => {
  it.each([
    ['acme', 'app'],
    ['a', 'my.repo_name-2'],
    ['A'.repeat(39), 'x'.repeat(100)],
  ])('accepts %s/%s', (owner, name) => {
    expect(Repository.safeParse({ owner, name }).success).toBe(true);
  });

  it.each([
    ['-acme', 'app'],
    ['A'.repeat(40), 'app'],
    ['ac_me', 'app'],
    ['acme', '..'],
    ['acme', '.'],
    ['acme', 'x'.repeat(101)],
    ['acme', 'a/b'],
    ['acme', ''],
  ])('rejects %s/%s', (owner, name) => {
    expect(Repository.safeParse({ owner, name }).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(Repository.safeParse({ owner: 'acme', name: 'app', host: 'x' }).success).toBe(false);
  });
});

describe('GitRef', () => {
  it.each(['main', 'feature/x.y_z-1', 'v1.2.3', 'a'.repeat(255)])('accepts %s', (ref) => {
    expect(GitRef.safeParse(ref).success).toBe(true);
  });

  it.each(['', '-main', '--upload-pack=x', '/main', 'a..b', 'has space', 'a~1', 'a'.repeat(256)])(
    'rejects %j',
    (ref) => {
      expect(GitRef.safeParse(ref).success).toBe(false);
    },
  );
});

describe('RunCreateInput', () => {
  it('accepts a valid input', () => {
    expect(RunCreateInput.parse(createInput())).toEqual(createInput());
  });

  it('accepts a prompt of 20,000 characters', () => {
    expect(RunCreateInput.safeParse(createInput({ prompt: 'x'.repeat(20_000) })).success).toBe(
      true,
    );
  });

  it.each([
    ['prompt', 'x'.repeat(20_001)],
    ['prompt', ''],
    ['ref', '-main'],
    ['runnerId', 'runner-1'],
    ['repository', { owner: 'acme', name: '..' }],
  ])('rejects an invalid %s', (key, value) => {
    expect(RunCreateInput.safeParse(createInput({ [key]: value })).success).toBe(false);
  });

  it('rejects an unknown key', () => {
    expect(RunCreateInput.safeParse(createInput({ model: 'opus' })).success).toBe(false);
  });
});

describe('Run', () => {
  it('accepts a run', () => {
    expect(Run.parse(run())).toEqual(run());
  });

  it('rejects an unknown status', () => {
    expect(Run.safeParse(run({ status: 'paused' })).success).toBe(false);
  });

  it('strips unknown keys, including on the runner', () => {
    const parsed = Run.parse(
      run({ leaseExpiresAt: AT, runner: { ...summary().runner, tokenHash: 'h' } }),
    );
    expect(parsed).toEqual(run());
  });
});

describe('RunSummary', () => {
  it('strips the prompt', () => {
    expect(RunSummary.parse(run())).toEqual(summary());
  });
});
