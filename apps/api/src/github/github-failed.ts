import { err } from '../lib/result.ts';
import { GithubError } from './github.ts';

type GithubFailed = { ok: false; error: 'GITHUB_FAILED'; data: unknown };

/** GitHub's status and message as the GITHUB_FAILED error data. Any other error is rethrown. */
export function githubFailed(error: unknown): GithubFailed {
  if (!(error instanceof GithubError)) throw error;
  return err('GITHUB_FAILED', { status: error.status, message: error.message });
}
