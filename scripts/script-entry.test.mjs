import { afterEach, describe, expect, it, vi } from 'vitest';
import { reportFailure } from './script-entry.mjs';

describe('reportFailure', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it('prints the message and each cause, and sets exit code 1', () => {
    const printed = [];
    vi.spyOn(console, 'error').mockImplementation((line) => printed.push(line));
    const error = new Error('Docker is not running.', {
      cause: new Error('spawn docker ENOENT', { cause: new Error('not on PATH') }),
    });

    reportFailure(error);

    expect(printed).toEqual([
      'Docker is not running.',
      'Cause: spawn docker ENOENT',
      'Cause: not on PATH',
    ]);
    expect(process.exitCode).toBe(1);
  });
});
