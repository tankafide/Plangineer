import {
  DESCRIPTION_MAX,
  type RepositoryScan,
  SCAN_PATH_MAX,
  type ScannedSkill,
  SkillName,
} from '@plangineer/contracts';
import { recommendSkills } from '@plangineer/domain';
import { parse as parseYaml } from 'yaml';
import type { Tree, TreeEntry } from '../github/github.ts';

const SKILLS_MAX = 200;
const UNMOVABLE_MAX = 200;
const INSTRUCTION_FILES_MAX = 50;
const PACKAGE_JSON_MAX = 50;
const SKILL_FILE_MAX_BYTES = 256 * 1024;
const PACKAGE_JSON_MAX_BYTES = 1024 * 1024;
const REFERENCES_FOLDER = 'orchestrator-references';

const AGENTS_SKILLS = '.agents/skills/';
const CLAUDE_SKILLS = '.claude/skills/';
const INSTRUCTION_FILE_NAMES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
]);
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies'] as const;

interface FoundSkill {
  name: string;
  agents: TreeEntry | undefined;
  claude: TreeEntry | undefined;
}

/** What a scan reads from a tree, before any blob is fetched. */
export interface ScanPlan {
  commit: string;
  paths: string[];
  skills: FoundSkill[];
  packageJsons: TreeEntry[];
  unmovableContent: string[];
  instructionFiles: string[];
  orchestratorReferencesExist: boolean;
}

const inNodeModules = (path: string) => path.split('/').includes('node_modules');
const isSkillName = (name: string) =>
  name !== REFERENCES_FOLDER && SkillName.safeParse(name).success;

/** The skill folder a SKILL.md path names under a skills root, or undefined. */
function skillFolder(path: string, root: string): string | undefined {
  if (!path.startsWith(root)) return undefined;
  const parts = path.slice(root.length).split('/');
  return parts.length === 2 && parts[1] === 'SKILL.md' ? parts[0] : undefined;
}

function findSkills(blobs: TreeEntry[]): FoundSkill[] {
  const skills = new Map<string, FoundSkill>();
  for (const entry of blobs) {
    for (const [root, location] of [
      [AGENTS_SKILLS, 'agents'],
      [CLAUDE_SKILLS, 'claude'],
    ] as const) {
      const name = skillFolder(entry.path, root);
      if (name === undefined || !isSkillName(name)) continue;
      const skill = skills.get(name) ?? { name, agents: undefined, claude: undefined };
      skill[location] = entry;
      skills.set(name, skill);
    }
  }
  return [...skills.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * Files under .claude/skills/ that would be gone once the claude-only skills move and the mirror
 * syncs from .agents/skills/: anything whose .agents/ path will not exist.
 */
function findUnmovable(blobs: TreeEntry[], skills: FoundSkill[]): string[] {
  const agentsPaths = new Set(
    blobs.filter((entry) => entry.path.startsWith(AGENTS_SKILLS)).map((entry) => entry.path),
  );
  const moved = new Set(
    skills.filter((skill) => skill.agents === undefined).map((skill) => skill.name),
  );
  return blobs
    .filter((entry) => entry.path.startsWith(CLAUDE_SKILLS))
    .filter((entry) => {
      const rest = entry.path.slice(CLAUDE_SKILLS.length);
      const folder = rest.includes('/') ? rest.split('/')[0] : undefined;
      return !agentsPaths.has(AGENTS_SKILLS + rest) && !(folder && moved.has(folder));
    })
    .map((entry) => entry.path);
}

function isInstructionFile(path: string): boolean {
  if (inNodeModules(path) || path.length > SCAN_PATH_MAX) return false;
  const name = path.split('/').at(-1) ?? '';
  return (
    INSTRUCTION_FILE_NAMES.has(name) ||
    path === '.github/copilot-instructions.md' ||
    path.startsWith('.cursor/rules/')
  );
}

/** Reads a tree into a scan plan, or undefined when the repository is too large to scan. */
export function planScan(tree: Tree): ScanPlan | undefined {
  if (tree.truncated) return undefined;
  const blobs = tree.entries.filter((entry) => entry.type === 'blob');
  const skills = findSkills(blobs);
  if (skills.length > SKILLS_MAX) return undefined;
  return {
    commit: tree.commit,
    paths: tree.entries.map((entry) => entry.path),
    skills,
    packageJsons: blobs
      .filter((entry) => entry.path.split('/').at(-1) === 'package.json')
      .filter((entry) => !inNodeModules(entry.path))
      .slice(0, PACKAGE_JSON_MAX),
    // A path over the cap is shown cut, since it must still block the setup.
    unmovableContent: findUnmovable(blobs, skills)
      .slice(0, UNMOVABLE_MAX)
      .map((path) => path.slice(0, SCAN_PATH_MAX)),
    instructionFiles: blobs
      .map((entry) => entry.path)
      .filter(isInstructionFile)
      .slice(0, INSTRUCTION_FILES_MAX),
    orchestratorReferencesExist: blobs.some((entry) =>
      entry.path.startsWith(`${AGENTS_SKILLS}${REFERENCES_FOLDER}/`),
    ),
  };
}

/** The SKILL.md that stays canonical: the .agents/skills/ copy when there is one. */
const canonical = (skill: FoundSkill) => skill.agents ?? skill.claude;

const readable = (entry: TreeEntry | undefined, maxBytes: number) =>
  entry !== undefined && entry.size !== null && entry.size <= maxBytes;

/** The blobs a scan reads: each canonical SKILL.md and package.json within its size cap. */
export function scanBlobShas(plan: ScanPlan): string[] {
  return [
    ...plan.skills
      .map(canonical)
      .filter((entry) => readable(entry, SKILL_FILE_MAX_BYTES))
      .map((entry) => entry?.sha ?? ''),
    ...plan.packageJsons
      .filter((entry) => readable(entry, PACKAGE_JSON_MAX_BYTES))
      .map((entry) => entry.sha),
  ];
}

/** The frontmatter description of a SKILL.md, or null when it has none that parses. */
function skillDescription(text: string | undefined): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text ?? '');
  if (!match) return null;
  try {
    const frontmatter: unknown = parseYaml(match[1] ?? '');
    if (typeof frontmatter !== 'object' || frontmatter === null) return null;
    const description: unknown = Reflect.get(frontmatter, 'description');
    return typeof description === 'string' && description.length <= DESCRIPTION_MAX
      ? description
      : null;
  } catch {
    return null;
  }
}

/** The dependency names in a package.json, or none when it is not valid JSON. */
function dependencyNames(text: string | undefined): string[] {
  let manifest: unknown;
  try {
    manifest = JSON.parse(text ?? '');
  } catch {
    return [];
  }
  if (typeof manifest !== 'object' || manifest === null) return [];
  return DEPENDENCY_FIELDS.flatMap((field) => {
    const block: unknown = Reflect.get(manifest, field);
    return typeof block === 'object' && block !== null ? Object.keys(block) : [];
  });
}

function scannedSkill(skill: FoundSkill, blobs: Map<string, string>): ScannedSkill {
  const entry = canonical(skill);
  const location = skill.agents && skill.claude ? 'both' : skill.agents ? 'agents' : 'claude';
  const text = readable(entry, SKILL_FILE_MAX_BYTES) ? blobs.get(entry?.sha ?? '') : undefined;
  return { name: skill.name, description: skillDescription(text), location };
}

/** The scan of a planned tree, given the blobs scanBlobShas named. */
export function buildScan(
  plan: ScanPlan,
  blobs: Map<string, string>,
  context: { defaultBranch: string; scannedAt: string },
): RepositoryScan {
  const skills = plan.skills.map((skill) => scannedSkill(skill, blobs));
  const dependencies = new Set(
    plan.packageJsons
      .filter((entry) => readable(entry, PACKAGE_JSON_MAX_BYTES))
      .flatMap((entry) => dependencyNames(blobs.get(entry.sha))),
  );
  return {
    commit: plan.commit,
    defaultBranch: context.defaultBranch,
    scannedAt: context.scannedAt,
    skills,
    orchestratorReferencesExist: plan.orchestratorReferencesExist,
    unmovableContent: plan.unmovableContent,
    instructionFiles: plan.instructionFiles,
    recommendations: recommendSkills({
      paths: plan.paths,
      dependencies,
      existingSkillNames: new Set(skills.map((skill) => skill.name)),
    }),
  };
}
