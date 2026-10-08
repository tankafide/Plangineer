import { createHash } from 'node:crypto';
import { access, lstat, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { SKILLS_ROOT, SLOT_LINE_PATTERN, type SetupJob } from '@plangineer/contracts';

const MIRROR_DIR = '.claude/skills';
export const INPUTS_DIR = '.plangineer-setup';

/** A setup step that found the job's output breaks a rule. Nothing is pushed after one. */
export class SetupOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupOutputError';
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/** Every file under `dir`, relative to it with `/`, failing on a link. */
async function listFiles(dir: string, rel = ''): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(path.join(dir, rel), { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const child = rel === '' ? entry.name : `${rel}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new SetupOutputError(`A skill file is a link: ${child}`);
    if (entry.isDirectory()) files.push(...(await listFiles(dir, child)));
    else files.push(child);
  }
  return files.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

const toPath = (root: string, rel: string) => path.join(root, ...rel.split('/'));

/** Every path setup writes, deletes or creates folders through. None may be a link. */
const WRITTEN_PATHS = [
  '.agents',
  SKILLS_ROOT,
  '.claude',
  MIRROR_DIR,
  INPUTS_DIR,
  '.github',
  '.github/workflows',
  '.github/workflows/plangineer-skills.yml',
  '.gitattributes',
];

/**
 * Fails when the checkout makes any path setup writes through a link, which would send its
 * writes and the mirror sync's deletes outside the worktree.
 */
export async function refuseLinkedPaths(worktree: string): Promise<void> {
  for (const rel of WRITTEN_PATHS) {
    let isLink: boolean;
    try {
      isLink = (await lstat(toPath(worktree, rel))).isSymbolicLink();
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    if (isLink) throw new SetupOutputError(`${rel} is a link, so setup will not write through it`);
  }
  // Listing fails on any link inside the skill trees, such as a linked skill folder.
  await listFiles(path.join(worktree, SKILLS_ROOT));
  await listFiles(path.join(worktree, MIRROR_DIR));
}

/** Copies each claude-only skill to .agents/skills/ byte for byte. */
export async function moveSkills(worktree: string, names: readonly string[]): Promise<void> {
  for (const name of names) {
    const source = path.join(worktree, MIRROR_DIR, name);
    const target = path.join(worktree, SKILLS_ROOT, name);
    if ((await lstat(source)).isSymbolicLink()) {
      throw new SetupOutputError(`The skill ${name} is a link`);
    }
    if (await exists(target)) throw new SetupOutputError(`${SKILLS_ROOT}/${name} already exists`);
    for (const rel of await listFiles(source)) {
      const file = toPath(target, rel);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, await readFile(toPath(source, rel)));
    }
  }
}

/** Writes the rendered files, which must be new and inside .agents/skills/, and the inputs. */
export async function writeSetupFiles(worktree: string, job: SetupJob): Promise<void> {
  const skillsRoot = path.join(worktree, SKILLS_ROOT);
  for (const file of job.files) {
    const target = toPath(worktree, file.path);
    const inside = path.relative(skillsRoot, target);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      throw new SetupOutputError(`${file.path} is outside ${SKILLS_ROOT}`);
    }
    if (await exists(target)) throw new SetupOutputError(`${file.path} already exists`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await mkdir(path.join(worktree, INPUTS_DIR), { recursive: true });
  await writeFile(path.join(worktree, INPUTS_DIR, 'inputs.md'), job.inputs);
}

/** What .agents/skills/ held before the agent ran. */
export interface SkillSnapshot {
  /** Each file the agent must not change, by its path under .agents/skills/, to its SHA-256. */
  hashes: Map<string, string>;
  /** Each template skill's SKILL.md, split at its slot lines into the text the agent keeps. */
  templates: Map<string, string[]>;
  folders: Set<string>;
}

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');
const isSlotLine = (line: string) => SLOT_LINE_PATTERN.test(line);
const templatePath = (name: string) => `${name}/SKILL.md`;

/** The text around a template's slot lines, in order, with each line break kept. */
function fixedSegments(text: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let offset = 0;
  for (const line of text.split('\n')) {
    if (isSlotLine(line)) {
      segments.push(text.slice(start, offset));
      start = offset + line.length;
    }
    offset += line.length + 1;
  }
  segments.push(text.slice(start));
  return segments;
}

export async function snapshotSkills(worktree: string, job: SetupJob): Promise<SkillSnapshot> {
  const root = path.join(worktree, SKILLS_ROOT);
  const templates = new Set(job.templateSkills.map(templatePath));
  const snapshot: SkillSnapshot = { hashes: new Map(), templates: new Map(), folders: new Set() };
  for (const rel of await listFiles(root)) {
    snapshot.folders.add(rel.split('/')[0] ?? '');
    const content = await readFile(toPath(root, rel));
    if (templates.has(rel)) snapshot.templates.set(rel, fixedSegments(content.toString('utf8')));
    else snapshot.hashes.set(rel, sha256(content));
  }
  return snapshot;
}

/** Whether the filled text keeps every fixed segment, in order, from the start to the end. */
function keepsSegments(text: string, segments: string[]): boolean {
  const first = segments[0] ?? '';
  const last = segments.at(-1) ?? '';
  if (!text.startsWith(first) || !text.endsWith(last)) return false;
  let position = first.length;
  for (const segment of segments.slice(1, -1)) {
    const found = text.indexOf(segment, position);
    if (found === -1) return false;
    position = found + segment.length;
  }
  return text.length - last.length >= position;
}

/**
 * The rules the agent's changes broke: a file it must keep changed or went, a template's fixed
 * text changed or a slot left, a new file outside a new generated folder, or a generated skill
 * missing. An empty list means the work stands.
 */
export async function checkAgentWork(
  worktree: string,
  job: SetupJob,
  snapshot: SkillSnapshot,
): Promise<string[]> {
  const root = path.join(worktree, SKILLS_ROOT);
  const files = new Set(await listFiles(root));
  const problems: string[] = [];
  for (const [rel, hash] of snapshot.hashes) {
    if (!files.has(rel)) problems.push(`${SKILLS_ROOT}/${rel} was deleted`);
    else if (sha256(await readFile(toPath(root, rel))) !== hash) {
      problems.push(`${SKILLS_ROOT}/${rel} was changed`);
    }
  }
  for (const [rel, segments] of snapshot.templates) {
    const text = files.has(rel) ? (await readFile(toPath(root, rel))).toString('utf8') : '';
    if (!keepsSegments(text, segments)) {
      problems.push(`${SKILLS_ROOT}/${rel} changed text outside its slots`);
    }
    if (text.split('\n').some(isSlotLine))
      problems.push(`${SKILLS_ROOT}/${rel} still has a slot line`);
  }
  const generated = new Set(job.generateSkills);
  for (const rel of files) {
    if (snapshot.hashes.has(rel) || snapshot.templates.has(rel)) continue;
    const folder = rel.split('/')[0] ?? '';
    if (snapshot.folders.has(folder) || !rel.includes('/') || !generated.has(folder)) {
      problems.push(`${SKILLS_ROOT}/${rel} is a new file outside a skill the job asked for`);
    }
  }
  for (const name of job.generateSkills) {
    if (!files.has(templatePath(name)))
      problems.push(`${SKILLS_ROOT}/${name}/SKILL.md was not written`);
  }
  return problems;
}

/** The skills to lint: each folder the job wrote, and each skill the agent wrote. */
export function lintedSkills(job: SetupJob): string[] {
  const written = job.files.map((file) => file.path.split('/')[2] ?? '');
  return [...new Set([...written, ...job.generateSkills])].filter(
    (name) => name !== 'orchestrator-references',
  );
}
