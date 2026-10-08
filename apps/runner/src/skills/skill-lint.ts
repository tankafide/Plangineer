import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { CommandResult } from '../command-result.ts';

const SKILLS_DIR = '.agents/skills';
const REFERENCES_FOLDER = 'orchestrator-references';
const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1_024;
const LINES_MAX = 500;
const FRONTMATTER_FIELDS = new Set(['name', 'description', 'disable-model-invocation']);
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL_TARGET = /^([a-z][a-z0-9+.-]*:|#)/i;

const isOrchestrator = (name: string) => name.endsWith('-orchestrator');

async function readText(file: string): Promise<string | null> {
  try {
    return (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** Markdown with its fenced blocks and inline code spans removed, since links there are text. */
function proseOf(markdown: string): string {
  return markdown
    .replaceAll(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replaceAll(/(`+)[^`]*?\1/g, '');
}

/** The relative link targets in Markdown prose, without anchors. */
function relativeLinks(markdown: string): string[] {
  return [...proseOf(markdown).matchAll(LINK_PATTERN)]
    .map((match) => match[1] ?? '')
    .filter((target) => !EXTERNAL_TARGET.test(target))
    .map((target) => target.split('#')[0] ?? '')
    .filter((target) => target !== '');
}

function checkFrontmatter(name: string, frontmatter: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const field of Object.keys(frontmatter)) {
    if (!FRONTMATTER_FIELDS.has(field)) problems.push(`frontmatter has an unknown field: ${field}`);
  }
  const { description } = frontmatter;
  if (frontmatter['name'] !== name) problems.push('frontmatter name must equal the folder name');
  if (name.length > NAME_MAX || !NAME_PATTERN.test(name)) {
    problems.push(`name must be at most ${NAME_MAX} lowercase letters, digits and hyphens`);
  }
  if (/claude|anthropic/.test(name)) problems.push('name must not contain claude or anthropic');
  if (typeof description !== 'string' || description.trim() === '') {
    problems.push('frontmatter must have a description');
  } else if (description.length > DESCRIPTION_MAX) {
    problems.push(`description is over ${DESCRIPTION_MAX} characters`);
  }
  const hidden = frontmatter['disable-model-invocation'] === true;
  if (isOrchestrator(name) && 'disable-model-invocation' in frontmatter) {
    problems.push('an orchestrator must not set disable-model-invocation');
  }
  if (!isOrchestrator(name) && !hidden) {
    problems.push('frontmatter must set disable-model-invocation: true');
  }
  return problems;
}

async function checkOpenaiYaml(skillDir: string, name: string): Promise<string[]> {
  const text = await readText(path.join(skillDir, 'agents', 'openai.yaml'));
  if (isOrchestrator(name)) {
    return text === null ? [] : ['an orchestrator must not have agents/openai.yaml'];
  }
  if (text === null) return ['agents/openai.yaml is missing'];
  let config: unknown;
  try {
    config = parseYaml(text);
  } catch {
    return ['agents/openai.yaml is not valid YAML'];
  }
  const policy = asRecord(asRecord(config)?.['policy']);
  return policy?.['allow_implicit_invocation'] === false
    ? []
    : ['agents/openai.yaml must set policy.allow_implicit_invocation: false'];
}

async function checkLinks(skillDir: string, body: string, linkRoot: string): Promise<string[]> {
  const problems: string[] = [];
  for (const target of relativeLinks(body)) {
    const resolved = path.resolve(skillDir, target);
    const inside = path.relative(linkRoot, resolved);
    if (inside.startsWith('..') || path.isAbsolute(inside)) {
      problems.push(`link leaves ${path.basename(linkRoot)}: ${target}`);
    } else if (!(await isFile(resolved))) {
      problems.push(`link does not resolve to a file: ${target}`);
    }
  }
  return problems;
}

/**
 * The problems with one skill folder under `skillsRoot`. A name ending in `-orchestrator` is an
 * orchestrator, and every other name a rule skill. Links must resolve to files inside
 * `linkRoot`, and links inside code are text.
 */
export async function lintSkill(
  skillsRoot: string,
  name: string,
  linkRoot: string,
): Promise<string[]> {
  const skillDir = path.join(skillsRoot, name);
  const text = await readText(path.join(skillDir, 'SKILL.md'));
  if (text === null) return ['SKILL.md is missing'];
  const match = FRONTMATTER_PATTERN.exec(text);
  let frontmatter: Record<string, unknown> | null = null;
  try {
    frontmatter = match ? asRecord(parseYaml(match[1] ?? '')) : null;
  } catch {
    frontmatter = null;
  }
  if (frontmatter === null) return ['SKILL.md has no valid frontmatter'];
  const lines = text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
  return [
    ...checkFrontmatter(name, frontmatter),
    ...(lines >= LINES_MAX ? [`SKILL.md must be under ${LINES_MAX} lines`] : []),
    ...(await checkOpenaiYaml(skillDir, name)),
    ...(await checkLinks(skillDir, match?.[2] ?? '', linkRoot)),
  ];
}

/** `skills lint`: lints every skill under .agents/skills/, with links resolving in the repository. */
export async function lintSkills(repoRoot: string): Promise<CommandResult> {
  const skillsRoot = path.join(repoRoot, SKILLS_DIR);
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name !== REFERENCES_FOLDER)
    .map((entry) => entry.name)
    .toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const problems: string[] = [];
  for (const name of names) {
    for (const problem of await lintSkill(skillsRoot, name, repoRoot)) {
      problems.push(`${SKILLS_DIR}/${name}: ${problem}`);
    }
  }
  return problems.length === 0
    ? { ok: true, message: `Skills lint passed: ${names.length} skills.` }
    : { ok: false, message: problems.join('\n') };
}
