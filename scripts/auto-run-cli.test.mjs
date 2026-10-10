import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCli } from './auto-run.mjs';

describe('parseCli', () => {
  it('defaults both review loops to two rounds', () => {
    expect(parseCli(['--request-file', 'r.md'])).toEqual({
      requestFile: 'r.md',
      planPath: undefined,
      resumeLog: undefined,
      planRounds: 2,
      implementationRounds: 2,
    });
  });

  it('takes the round counts', () => {
    const options = parseCli([
      '--plan',
      'p.md',
      '--plan-rounds',
      '4',
      '--implementation-rounds',
      '1',
    ]);
    expect(options).toMatchObject({ planPath: 'p.md', planRounds: 4, implementationRounds: 1 });
  });

  it.each([
    [[]],
    [['--request-file', 'r.md', '--plan', 'p.md']],
    [['--plan', 'p.md', '--resume', 'logs/auto/x/implementation.jsonl']],
  ])('requires exactly one of a request, a plan and a resumed log: %j', (argv) => {
    expect(() => parseCli(argv)).toThrow('Pass exactly one of --request-file, --plan and --resume');
  });

  it('resolves the resumed log against the current folder', () => {
    expect(parseCli(['--resume', 'logs/auto/x/plan.jsonl']).resumeLog).toBe(
      path.resolve('logs/auto/x/plan.jsonl'),
    );
  });

  it('refuses round counts for a resumed run, which keeps its settings', () => {
    expect(() => parseCli(['--resume', 'plan.jsonl', '--plan-rounds', '3'])).toThrow(
      'A resumed run keeps its settings, so it takes no round counts',
    );
  });

  it('rejects a round count under one', () => {
    expect(() => parseCli(['--plan', 'p.md', '--plan-rounds', '0'])).toThrow(
      'expected number to be >=1',
    );
  });
});
