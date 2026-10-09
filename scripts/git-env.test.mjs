import { describe, expect, it } from 'vitest';
import { removeGitLocalEnv } from './git-env.mjs';

describe('removeGitLocalEnv', () => {
  it('deletes the variables git sets for a hook and keeps the rest', () => {
    const env = { GIT_DIR: '.git', GIT_INDEX_FILE: 'index', GIT_WORK_TREE: '.', PATH: 'bin' };

    removeGitLocalEnv(env);

    expect(env).toEqual({ PATH: 'bin' });
  });
});
