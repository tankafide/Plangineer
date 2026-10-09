import { execaSync } from 'execa';

/**
 * Deletes the repository-local variables git sets for hooks, such as GIT_DIR and GIT_INDEX_FILE.
 * A test that runs git in a temp repository while a hook runs would otherwise act on this one.
 */
export function removeGitLocalEnv(env) {
  const { stdout } = execaSync('git', ['rev-parse', '--local-env-vars']);
  for (const name of stdout.split(/\r?\n/).filter(Boolean)) delete env[name];
}
