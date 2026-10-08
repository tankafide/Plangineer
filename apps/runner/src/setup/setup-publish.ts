import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SETUP_BRANCH,
  SETUP_PUSHED_PATHS_MAX,
  SETUP_PUSHED_PATHS_MAX_BYTES,
} from '@plangineer/contracts';
import { syncSkills } from '../skills/skills-mirror.ts';
import { git, gitBytes } from '../worktrees/git.ts';
import { INPUTS_DIR, SetupOutputError } from './setup-tree.ts';

const GITATTRIBUTES = '.gitattributes';
const GENERATED_MIRROR = '.claude/skills/** linguist-generated';
const WORKFLOW = '.github/workflows/plangineer-skills.yml';
const ALLOWED_PREFIXES = ['.agents/skills/', '.claude/skills/'];
const ALLOWED_FILES = new Set([GITATTRIBUTES, WORKFLOW]);
const PATH_MAX = 300;

function workflow(defaultBranch: string, runnerVersion: string): string {
  return [
    'name: Plangineer skills',
    'on:',
    '  pull_request:',
    '  push:',
    `    branches: ['${defaultBranch}']`,
    'permissions:',
    '  contents: read',
    'jobs:',
    '  skills-check:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - uses: actions/setup-node@v7',
    '        with:',
    '          node-version: 24',
    `      - run: npx --yes plangineer-runner@${runnerVersion} skills check`,
    '',
  ].join('\n');
}

async function addGeneratedAttribute(worktree: string): Promise<void> {
  const file = path.join(worktree, GITATTRIBUTES);
  let text: string;
  try {
    text = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    text = '';
  }
  if (text.split('\n').includes(GENERATED_MIRROR)) return;
  const separator = text === '' || text.endsWith('\n') ? '' : '\n';
  await writeFile(file, `${text}${separator}${GENERATED_MIRROR}\n`);
}

/**
 * Removes the inputs, syncs the mirror, marks the mirror generated and writes the workflow that
 * checks it, so the pushed branch is ready for review.
 */
export async function finishRepositoryFiles(
  worktree: string,
  options: { defaultBranch: string; runnerVersion: string },
): Promise<void> {
  await rm(path.join(worktree, INPUTS_DIR), { recursive: true, force: true });
  const synced = await syncSkills(worktree);
  if (!synced.ok) throw new SetupOutputError(synced.message);
  await addGeneratedAttribute(worktree);
  const workflowFile = path.join(worktree, ...WORKFLOW.split('/'));
  await mkdir(path.dirname(workflowFile), { recursive: true });
  await writeFile(workflowFile, workflow(options.defaultBranch, options.runnerVersion));
}

/** Every changed path in the worktree, untracked files included, from git's NUL-separated status. */
function statusPaths(status: string): string[] {
  const fields = status.split('\0').filter((field) => field !== '');
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';
    paths.push(field.slice(3));
    // A rename or copy carries its source path as the next field.
    if (field[0] === 'R' || field[0] === 'C') {
      index += 1;
      paths.push(fields[index] ?? '');
    }
  }
  return paths;
}

const isAllowed = (file: string) =>
  ALLOWED_FILES.has(file) || ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix));

/** Fails when the worktree changed any path setup may not write. */
export async function guardChangedPaths(worktree: string): Promise<void> {
  // Read untrimmed: a status entry can start with a space.
  const status = (
    await gitBytes(worktree, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], '')
  ).toString('utf8');
  const outside = statusPaths(status).filter((file) => !isAllowed(file));
  if (outside.length > 0) {
    throw new SetupOutputError(`The setup changed files it may not: ${outside.join(', ')}`);
  }
}

export interface Pushed {
  commit: string;
  changedPaths: string[];
  changedPathCount: number;
}

/** The first changed paths in path order, within both caps of one setup.pushed event. */
function listedPaths(paths: string[]): string[] {
  const listed: string[] = [];
  let bytes = 2;
  for (const file of paths) {
    if (file.length > PATH_MAX || listed.length >= SETUP_PUSHED_PATHS_MAX) break;
    const entryBytes = Buffer.byteLength(JSON.stringify(file)) + 1;
    if (bytes + entryBytes > SETUP_PUSHED_PATHS_MAX_BYTES) break;
    listed.push(file);
    bytes += entryBytes;
  }
  return listed;
}

/**
 * Commits everything and force-pushes it to plangineer/setup, with the engineer's own git
 * identity and credentials. Signing and hooks are skipped, since no one is at a terminal and
 * the target's hooks must not run on the engineer's machine.
 */
export async function publishSetup(worktree: string, baseCommit: string): Promise<Pushed> {
  await git(worktree, ['add', '--all']);
  await git(worktree, [
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--no-verify',
    '-m',
    'Set up Plangineer skills',
  ]);
  await git(worktree, [
    'push',
    '--force',
    '--no-verify',
    '--porcelain',
    'origin',
    `HEAD:refs/heads/${SETUP_BRANCH}`,
  ]);
  const commit = await git(worktree, ['rev-parse', 'HEAD']);
  const changed = (
    await git(worktree, ['diff', '--name-only', '-z', '--end-of-options', baseCommit, commit])
  )
    .split('\0')
    .filter((file) => file !== '')
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return { commit, changedPaths: listedPaths(changed), changedPathCount: changed.length };
}
