import { copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { isEntryPoint, reportFailure } from './script-entry.mjs';

const USAGE = 'Usage: pnpm worktree:new <type>/<slug>';

async function git(cwd, args) {
  const { stdout } = await execa('git', args, { cwd });
  return stdout.trim();
}

async function branchExists(cwd, ref) {
  const { exitCode } = await execa('git', ['show-ref', '--verify', '--quiet', ref], {
    cwd,
    reject: false,
  });
  return exitCode === 0;
}

async function requireFile(file, message) {
  const found = await stat(file).then(
    (stats) => stats.isFile(),
    () => false,
  );
  if (!found) throw new Error(message);
}

/**
 * Creates a worktree for branch beside the main checkout, ready for checks: it copies the main
 * checkout's `.env`, which Git ignores, and installs dependencies. A new branch starts from the
 * default branch on origin, and an existing local or remote branch is checked out as it is.
 */
export async function createWorktree({ cwd, branch, install }) {
  if (!branch) throw new Error(USAGE);
  await git(cwd, ['check-ref-format', '--branch', branch]);
  const checkout = path.dirname(
    await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
  );
  const envFile = path.join(checkout, '.env');
  await requireFile(envFile, `${envFile} is missing. Run pnpm setup:env in the main checkout.`);
  const slug = branch.slice(branch.indexOf('/') + 1);
  const worktree = path.join(path.dirname(checkout), `${path.basename(checkout)}.worktrees`, slug);

  await git(checkout, ['fetch', '--quiet', 'origin']);
  const exists =
    (await branchExists(checkout, `refs/heads/${branch}`)) ||
    (await branchExists(checkout, `refs/remotes/origin/${branch}`));
  const base = await git(checkout, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  const add = exists ? [worktree, branch] : ['-b', branch, worktree, base];
  await git(checkout, ['worktree', 'add', '--quiet', ...add]);

  await copyFile(envFile, path.join(worktree, '.env'));
  await install(worktree);
  return worktree;
}

if (isEntryPoint(import.meta.url)) {
  try {
    const worktree = await createWorktree({
      cwd: process.cwd(),
      branch: process.argv[2],
      install: (dir) =>
        execa('pnpm', ['install', '--frozen-lockfile'], { cwd: dir, stdio: 'inherit' }),
    });
    console.log(worktree);
  } catch (error) {
    reportFailure(error);
  }
}
