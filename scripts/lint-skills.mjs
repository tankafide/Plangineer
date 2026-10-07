import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)\)/g;
const EXTERNAL_TARGET_PATTERN = /^([a-z][a-z0-9+.-]*:|#)/i;
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
  return lines.slice(start + 1, end).join('\n').trim();
}

export function extractRelativeLinks(markdown) {
  return [...markdown.matchAll(LINK_PATTERN)]
    .map((match) => match[1])
    .filter((target) => !EXTERNAL_TARGET_PATTERN.test(target))
    .map((target) => target.split('#')[0])
    .filter((target) => target !== '');
}

export function extractRoutedSkills(section) {
  return [...new Set([...section.matchAll(SKILL_PATH_PATTERN)].map((match) => match[1]))];
}

async function isFile(file) {
  return stat(file).then((stats) => stats.isFile(), () => false);
}

async function readText(file) {
  return readFile(file, 'utf8').catch(() => null);
}

async function checkTierSettings(skillDir, name, isOrchestrator) {
  const skillText = await readText(path.join(skillDir, 'SKILL.md'));
  if (skillText === null) return [`${name}: SKILL.md is missing`];
  let frontmatter;
  try {
    frontmatter = parseFrontmatter(skillText).data;
  } catch (error) {
    return [`${name}: SKILL.md ${error.message}`];
  }
  const problems = [];
  const hidden = frontmatter['disable-model-invocation'] === true;
  if (isOrchestrator && hidden) {
    problems.push(`${name}: an orchestrator must not set disable-model-invocation`);
  }
  if (!isOrchestrator && !hidden) {
    problems.push(`${name}: frontmatter must set disable-model-invocation: true`);
  }
  problems.push(...(await checkOpenaiPolicy(skillDir, name, isOrchestrator)));
  return problems;
}

async function checkOpenaiPolicy(skillDir, name, isOrchestrator) {
  const yamlText = await readText(path.join(skillDir, 'agents', 'openai.yaml'));
  if (yamlText === null) {
    return isOrchestrator ? [] : [`${name}: agents/openai.yaml is missing`];
  }
  let config;
  try {
    config = parse(yamlText);
  } catch (error) {
    return [`${name}: agents/openai.yaml is not valid YAML (${error.message})`];
  }
  const implicit = config?.policy?.allow_implicit_invocation;
  if (isOrchestrator && implicit === false) {
    return [`${name}: agents/openai.yaml must not set policy.allow_implicit_invocation: false`];
  }
  if (!isOrchestrator && implicit !== false) {
    return [`${name}: agents/openai.yaml must set policy.allow_implicit_invocation: false`];
  }
  return [];
}

async function checkLinks(skillDir, name, body) {
  const problems = [];
  for (const target of extractRelativeLinks(body)) {
    if (!(await isFile(path.resolve(skillDir, target)))) {
      problems.push(`${name}: link does not resolve to a file: ${target}`);
    }
  }
  return problems;
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
    ...(await checkLinks(skillDir, name, body)),
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
    .sort();
}

export async function lintSkills(rootDir) {
  const skillsRoot = path.join(rootDir, SKILLS_DIR);
  const names = await listSkillNames(skillsRoot);
  const problems = [...(await checkReferencesFolder(skillsRoot))];

  for (const name of ORCHESTRATORS.filter((orchestrator) => !names.includes(orchestrator))) {
    problems.push(`${name}: skill folder is missing`);
  }
  for (const name of names) {
    const isOrchestrator = ORCHESTRATORS.includes(name);
    problems.push(...(await checkTierSettings(path.join(skillsRoot, name), name, isOrchestrator)));
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

export async function main(rootDir) {
  const problems = await lintSkills(rootDir);
  if (problems.length > 0) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} skills lint problem(s). Fix them under ${SKILLS_DIR}/.`);
    return 1;
  }
  console.log('Skills lint passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.exitCode = await main(rootDir);
}
