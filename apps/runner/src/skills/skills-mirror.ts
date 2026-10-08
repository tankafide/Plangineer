import { mkdir, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CommandResult } from '../command-result.ts';
import { gitIndex, type SkillTree, toDisplayPath, workingTree } from './skill-trees.ts';

const SOURCE_DIR = '.agents/skills';
const MIRROR_DIR = '.claude/skills';
const FIX = `Edit the file under ${SOURCE_DIR}/, then run pnpm skills:sync.`;
const STAGED_FIX = `Edit the file under ${SOURCE_DIR}/, then run pnpm skills:sync and stage ${MIRROR_DIR}/.`;
/** The most files a drift message names, so it fits a run's failure message. */
const MAX_NAMED_FILES = 20;

export interface SyncPlan {
  missing: string[];
  changed: string[];
  stray: string[];
  contents: Map<string, Buffer>;
}

/** Converts CRLF to LF in text. Content with a NUL byte is binary and left alone. */
export function normalizeContent(content: Buffer): Buffer {
  if (content.includes(0)) return content;
  return Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1');
}

export async function planSync(tree: SkillTree): Promise<SyncPlan> {
  const sourceFiles = await tree.list(SOURCE_DIR);
  const mirrorFiles = await tree.list(MIRROR_DIR);
  const sourceSet = new Set(sourceFiles);
  const mirrorSet = new Set(mirrorFiles);
  const plan: SyncPlan = { missing: [], changed: [], stray: [], contents: new Map() };

  for (const rel of sourceFiles) {
    const expected = normalizeContent(await tree.read(SOURCE_DIR, rel));
    plan.contents.set(rel, expected);
    if (!mirrorSet.has(rel)) {
      plan.missing.push(rel);
      continue;
    }
    const actual = normalizeContent(await tree.read(MIRROR_DIR, rel));
    if (!expected.equals(actual)) plan.changed.push(rel);
  }
  plan.stray = mirrorFiles.filter((rel) => !sourceSet.has(rel));
  return plan;
}

export function hasDrift(plan: SyncPlan): boolean {
  return plan.missing.length + plan.changed.length + plan.stray.length > 0;
}

/** Names each drifting mirror file, up to 20 and then a count of the rest, and the fix. */
export function describeDrift(plan: SyncPlan, fix: string): string {
  const lines = [
    ...plan.missing.map((rel) => `missing: ${toDisplayPath(MIRROR_DIR, rel)}`),
    ...plan.changed.map((rel) => `changed: ${toDisplayPath(MIRROR_DIR, rel)}`),
    ...plan.stray.map((rel) => `stray: ${toDisplayPath(MIRROR_DIR, rel)}`),
  ];
  const named = lines.slice(0, MAX_NAMED_FILES);
  if (lines.length > MAX_NAMED_FILES) named.push(`and ${lines.length - MAX_NAMED_FILES} more`);
  return [...named, `Fix: ${fix}`].join('\n');
}

async function removeEmptyParents(stopDir: string, dir: string): Promise<void> {
  if (path.relative(stopDir, dir) === '') return;
  if ((await readdir(dir)).length > 0) return;
  await rmdir(dir);
  await removeEmptyParents(stopDir, path.dirname(dir));
}

export async function applySync(rootDir: string, plan: SyncPlan): Promise<void> {
  const mirrorRoot = path.join(rootDir, MIRROR_DIR);
  for (const rel of [...plan.missing, ...plan.changed]) {
    const content = plan.contents.get(rel);
    if (content === undefined) throw new Error(`No planned content for ${SOURCE_DIR}/${rel}`);
    const target = path.join(mirrorRoot, rel);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  for (const rel of plan.stray) {
    await rm(path.join(mirrorRoot, rel));
    await removeEmptyParents(mirrorRoot, path.dirname(path.join(mirrorRoot, rel)));
  }
}

/** Checks the working tree's mirror against its source, for a run's checkout. */
export async function checkSkillsMirror(
  repoRoot: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const plan = await planSync(workingTree(repoRoot));
  return hasDrift(plan) ? { ok: false, message: describeDrift(plan, FIX) } : { ok: true };
}

/** `skills check [--staged]`: reports drift between the source and its mirror, writing nothing. */
export async function checkSkills(
  repoRoot: string,
  options: { staged: boolean },
): Promise<CommandResult> {
  const plan = await planSync(options.staged ? gitIndex(repoRoot) : workingTree(repoRoot));
  if (hasDrift(plan)) {
    return { ok: false, message: describeDrift(plan, options.staged ? STAGED_FIX : FIX) };
  }
  return {
    ok: true,
    message: options.staged ? 'Staged skills mirror is in sync.' : 'Skills mirror is in sync.',
  };
}

/** `skills sync`: writes the mirror from the source. */
export async function syncSkills(repoRoot: string): Promise<CommandResult> {
  const plan = await planSync(workingTree(repoRoot));
  if (plan.contents.size === 0) {
    return { ok: false, message: `No skill files found under ${SOURCE_DIR}.` };
  }
  await applySync(repoRoot, plan);
  const written = plan.missing.length + plan.changed.length;
  return {
    ok: true,
    message: `Skills mirror synced: ${written} written, ${plan.stray.length} removed.`,
  };
}
