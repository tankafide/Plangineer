import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runnerPaths } from './runner-paths.ts';

const dataDir = path.resolve('runner-data');

describe('runnerPaths', () => {
  it('places every runner file under the data directory', () => {
    const paths = runnerPaths(dataDir);
    const runId = '0199c3a0-0000-7000-8000-000000000001';

    expect(paths.credentials).toBe(path.join(dataDir, 'runner.json'));
    expect(paths.logFile).toBe(path.join(dataDir, 'logs', 'runner.log'));
    expect(paths.bareClone({ owner: 'Acme', name: 'App' })).toBe(
      path.join(dataDir, 'repos', 'acme', 'app.git'),
    );
    expect(paths.worktree(runId, 2, { owner: 'Acme', name: 'App' })).toBe(
      path.join(dataDir, 'w', `${runId}-2`, 'App'),
    );
  });
});
