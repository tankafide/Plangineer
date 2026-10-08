import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { execa } from 'execa';
import { compareText } from './compare-text.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';
import { parse } from 'yaml';

const SKILLS_DIR = '.agents/skills';
const REFERENCES_DIR = 'orchestrator-references';
const ORCHESTRATORS = [
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
];
const DELEGATION_HEADING = 'Delegation rule';
const ROUTING_HEADING = 'Routing';
const SKILL_PATH_PATTERN = /\.agents\/skills\/([a-z0-9-]+)\/SKILL\.md/g;
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function toLf(text) {
  return text.replaceAll('\r\n', '\n');
}

export function parseFrontmatter(text) {
  const match = FRONTMATTER_PATTERN.exec(toLf(text));
  if (!match) throw new Error('missing frontmatter');
  return { data: parse(match[1]) ?? {}, body: match[2] };
}

export function extractSection(markdown, heading) {
  const lines = toLf(markdown).split('\n');
  const start = lines.indexOf(`## ${heading}`);
  if (start === -1) return null;
  const length = lines.slice(start + 1).findIndex((line) => line.startsWith('## '));
  const end = length === -1 ? lines.length : start + 1 + length;
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

export function extractRoutedSkills(section) {
  return [...new Set([...section.matchAll(SKILL_PATH_PATTERN)].map((match) => match[1]))];
}

async function isFile(file) {
  return stat(file).then(
    (stats) => stats.isFile(),
    () => false,
  );
}

async function readText(file) {
  return readFile(file, 'utf8').catch(() => null);
}

async function checkRouting(skillsRoot, name, section) {
  if (section === null) return [`${name}: missing a "## ${ROUTING_HEADING}" section`];
  const problems = [];
  for (const skill of extractRoutedSkills(section)) {
    if (!(await isFile(path.join(skillsRoot, skill, 'SKILL.md')))) {
      problems.push(`${name}: routing names ${skill}, which has no SKILL.md`);
    }
  }
  return problems;
}

async function readBody(skillDir) {
  const skillText = await readText(path.join(skillDir, 'SKILL.md'));
  try {
    return skillText === null ? null : parseFrontmatter(skillText).body;
  } catch {
    return null;
  }
}

async function checkOrchestrator(skillsRoot, name) {
  const skillDir = path.join(skillsRoot, name);
  const body = await readBody(skillDir);
  if (body === null) return { problems: [], delegation: null };
  const delegation = extractSection(body, DELEGATION_HEADING);
  const problems = [
    ...(delegation === null ? [`${name}: missing a "## ${DELEGATION_HEADING}" section`] : []),
    ...(await checkRouting(skillsRoot, name, extractSection(body, ROUTING_HEADING))),
  ];
  return { problems, delegation };
}

function checkDelegationIdentical(results) {
  const present = results.filter((result) => result.delegation !== null);
  if (present.length === 0) return [];
  const reference = present[0];
  return present
    .filter((result) => result.delegation !== reference.delegation)
    .map((result) => `${result.name}: "## ${DELEGATION_HEADING}" differs from ${reference.name}`);
}

async function checkReferencesFolder(skillsRoot) {
  const folder = path.join(skillsRoot, REFERENCES_DIR);
  if (await isFile(path.join(folder, 'SKILL.md'))) {
    return [`${REFERENCES_DIR}: must not have a SKILL.md`];
  }
  return [];
}

async function listSkillNames(skillsRoot) {
  const entries = await readdir(skillsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== REFERENCES_DIR)
    .map((entry) => entry.name)
    .toSorted(compareText);
}

/**
 * Plangineer's own checks: every orchestrator exists with the same delegation rule and routes
 * only to skills that exist. The runner's lint covers each skill's file rules and links.
 */
export async function lintSkills(rootDir) {
  const skillsRoot = path.join(rootDir, SKILLS_DIR);
  const names = await listSkillNames(skillsRoot);
  const problems = [...(await checkReferencesFolder(skillsRoot))];

  for (const name of ORCHESTRATORS.filter((orchestrator) => !names.includes(orchestrator))) {
    problems.push(`${name}: skill folder is missing`);
  }
  const results = [];
  for (const name of ORCHESTRATORS.filter((orchestrator) => names.includes(orchestrator))) {
    const result = await checkOrchestrator(skillsRoot, name);
    results.push({ name, ...result });
    problems.push(...result.problems);
  }
  problems.push(...checkDelegationIdentical(results));
  return problems;
}

/** Runs the runner's skill lint on the repository, so both lints apply the same file rules. */
async function runnerLint(rootDir) {
  const result = await execa(
    process.execPath,
    [path.join(repoRoot, 'apps/runner/src/cli.ts'), 'skills', 'lint'],
    { cwd: rootDir, reject: false, all: true },
  );
  return { ok: result.exitCode === 0, output: result.all };
}

export async function main(rootDir) {
  const runner = await runnerLint(rootDir);
  if (!runner.ok) {
    console.error(runner.output);
    console.error(`
The runner's skills lint failed. Fix the skills under ${SKILLS_DIR}/.`);
    return 1;
  }
  const problems = await lintSkills(rootDir);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} skills lint problem(s). Fix them under ${SKILLS_DIR}/.`);
    return 1;
  }
  console.log('Skills lint passed.');
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main(repoRoot);
}
