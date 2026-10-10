/** The git checks an auto run makes after each session, each failing the run with its step. */
import { execa } from 'execa';

async function git(cwd, ...args) {
  return (await execa('git', args, { cwd })).stdout;
}

export async function assertClean(cwd, step) {
  const status = await git(
    cwd,
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--no-renames',
    '-z',
  );
  const paths = status
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3));
  if (paths.length > 0) {
    throw new Error(`The ${step} session left uncommitted changes: ${paths.join(', ')}`);
  }
}

export async function assertDocsOnly(cwd, since, step) {
  const diff = await git(cwd, 'diff', '--no-renames', '--name-only', '-z', since, 'HEAD');
  const outside = diff
    .split('\0')
    .filter(Boolean)
    .filter((file) => !file.startsWith('docs/'));
  if (outside.length > 0) {
    throw new Error(`The ${step} session changed files outside docs/: ${outside.join(', ')}`);
  }
}

export async function assertNoCommits(cwd, since, step) {
  if ((await git(cwd, 'rev-parse', 'HEAD')).trim() === since) return;
  const log = await git(cwd, 'log', '--format=%h %s', `${since}..HEAD`);
  throw new Error(`The ${step} session made commits: ${log.trim().split(/\r?\n/).join(', ')}`);
}

/** The commit an implementation review starts from: where the branch left the default branch. */
export async function reviewBase(cwd) {
  return (await git(cwd, 'merge-base', 'HEAD', 'origin/HEAD')).trim();
}
