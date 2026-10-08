import { z } from 'zod';
import { CommitSha, GitRef } from './run.ts';

export const SkillName = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'must be lowercase letters, digits and single hyphens');
export type SkillName = z.infer<typeof SkillName>;

export const Orchestrator = z.enum([
  'plan-orchestrator',
  'plan-review-orchestrator',
  'implementation-orchestrator',
  'implementation-review-orchestrator',
]);
export type Orchestrator = z.infer<typeof Orchestrator>;

export const SetupStatus = z.enum(['scanned', 'generating', 'pr_open', 'complete', 'failed']);
export type SetupStatus = z.infer<typeof SetupStatus>;

export const CatalogKind = z.enum(['fixed', 'template', 'generated']);
export type CatalogKind = z.infer<typeof CatalogKind>;

/** The cap on the setup inputs document the runner writes into the worktree. */
export const SETUP_INPUTS_MAX = 100_000;
/** The cap on a serialized SetupJob, leaving room for the run.assign envelope in one socket message. */
export const SETUP_JOB_MAX_BYTES = 900 * 1024;
/** A template slot line, which the setup agent replaces whole. */
export const SLOT_LINE_PATTERN = /^<!-- slot: (fact|rule) [a-z0-9]+(-[a-z0-9]+)*: .{1,300} -->$/;
export const SETUP_BRANCH = 'plangineer/setup';

export const SKILLS_ROOT = '.agents/skills';
const SKILL_FILE_PATH = /^\.agents\/skills\/[a-z0-9-]+(\/[A-Za-z0-9._-]+)+$/;

/** A file the setup job writes, always under .agents/skills/. */
export const SkillFilePath = z
  .string()
  .max(300)
  .regex(SKILL_FILE_PATH, 'must be a file under .agents/skills/')
  .refine((path) => !path.split('/').includes('..'), 'must not contain a .. segment');

const SCAN_SKILLS_MAX = 200;
const INSTRUCTION_FILES_MAX = 50;
const RECOMMENDATIONS_MAX = 32;
export const DESCRIPTION_MAX = 1_024;
export const SCAN_PATH_MAX = 300;

export const SkillLocation = z.enum(['agents', 'claude', 'both']);
export type SkillLocation = z.infer<typeof SkillLocation>;

export const ScannedSkill = z.object({
  name: SkillName,
  description: z.string().max(DESCRIPTION_MAX).nullable(),
  location: SkillLocation,
});
export type ScannedSkill = z.infer<typeof ScannedSkill>;

export const Recommendation = z.object({
  name: SkillName,
  kind: CatalogKind,
  recommended: z.boolean(),
  required: z.boolean(),
  reason: z.string().max(200),
});
export type Recommendation = z.infer<typeof Recommendation>;

const ScanPath = z.string().min(1).max(SCAN_PATH_MAX);

export const RepositoryScan = z.object({
  commit: CommitSha,
  defaultBranch: GitRef,
  scannedAt: z.iso.datetime(),
  skills: z.array(ScannedSkill).max(SCAN_SKILLS_MAX),
  orchestratorReferencesExist: z.boolean(),
  unmovableContent: z.array(ScanPath).max(SCAN_SKILLS_MAX),
  instructionFiles: z.array(ScanPath).max(INSTRUCTION_FILES_MAX),
  recommendations: z.array(Recommendation).max(RECOMMENDATIONS_MAX),
});
export type RepositoryScan = z.infer<typeof RepositoryScan>;

function uniqueArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(item)
    .max(max)
    .refine((items) => new Set(items).size === items.length, 'must not repeat an item');
}

export const SetupSelection = z.strictObject({
  reuseSkills: uniqueArray(SkillName, SCAN_SKILLS_MAX),
  addSkills: uniqueArray(SkillName, RECOMMENDATIONS_MAX),
  orchestrators: uniqueArray(Orchestrator, Orchestrator.options.length),
});
export type SetupSelection = z.infer<typeof SetupSelection>;

export const SelectionError = z.enum([
  'unmovable_content',
  'nothing_chosen',
  'unknown_skill',
  'skill_exists',
  'orchestrator_exists',
  'required_skill_missing',
  'too_large',
]);
export type SelectionError = z.infer<typeof SelectionError>;
