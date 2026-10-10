import {
  type RepositoryScan,
  type RoleSetting,
  type RoleSettings,
  type RunMode,
  type SetupSelection,
  type SetupStatus,
} from '@plangineer/contracts';
import { BASELINE_CATALOG, recommendSkills } from '@plangineer/domain';
import { SEED_USER_IDS } from './seed-ids.ts';

/** Every seeded id and time is fixed, so a seed run is the same on every machine. */
export const SEED_AT = new Date('2026-10-08T09:00:00.000Z');
export const SEED_RUNNER_ID = '0199c1a2-0000-7000-8000-000000000101';
export const SEED_RUNNER_TOKEN_HASH = '0'.repeat(64);
export const SEED_COMMIT = '5eed'.repeat(10);
export const SEED_DEFAULT_BRANCH = 'main';

const ROLE: RoleSetting = {
  agent: 'claude_code',
  model: null,
  runsOn: 'local_runner',
  signIn: 'engineer_login',
};

export const SEED_ROLE_SETTINGS: RoleSettings = {
  pre_planning: ROLE,
  planning: ROLE,
  plan_review: ROLE,
  implementation: ROLE,
  implementation_review: ROLE,
  verification: ROLE,
};

export const SEED_USERS = [
  { id: SEED_USER_IDS.admin, name: 'Seed Admin', email: 'seed-admin@example.com', role: 'admin' },
  {
    id: SEED_USER_IDS.member,
    name: 'Seed Member',
    email: 'seed-member@example.com',
    role: 'member',
  },
] as const;

/** A scan with three skills, one under .claude/skills/ only, two instruction files and every recommendation. */
export function seedScan(unmovableContent: string[] = []): RepositoryScan {
  const skills = [
    {
      name: 'api-style',
      description: 'How our handlers are written.',
      location: 'agents' as const,
    },
    {
      name: 'legacy-review',
      description: 'The old review checklist.',
      location: 'claude' as const,
    },
    { name: 'release-notes', description: null, location: 'both' as const },
  ];
  return {
    commit: SEED_COMMIT,
    defaultBranch: SEED_DEFAULT_BRANCH,
    scannedAt: SEED_AT.toISOString(),
    skills,
    orchestratorReferences: [],
    unmovableContent,
    instructionFiles: ['AGENTS.md', 'web/CLAUDE.md'],
    recommendations: recommendSkills({
      paths: ['db/migrations/0001.sql', 'web/src/app.tsx', '.github/workflows/ci.yml'],
      dependencies: new Set(['hono', 'drizzle-orm', 'react', '@tanstack/react-query']),
      existingSkillNames: new Set(skills.map((skill) => skill.name)),
    }),
  };
}

export const SEED_SELECTION: SetupSelection = {
  reuseSkills: ['api-style', 'legacy-review'],
  addSkills: BASELINE_CATALOG.filter((entry) => entry.required)
    .map((entry) => entry.name)
    .concat('backend'),
  orchestrators: ['plan-orchestrator', 'implementation-orchestrator'],
};

export interface SeedRepository {
  id: string;
  name: string;
  description: string;
  defaultRunMode: RunMode;
  setup: SetupStatus | 'unmovable' | null;
}

const repositoryId = (index: number) =>
  `0199c1a2-0000-7000-8000-${String(200 + index).padStart(12, '0')}`;

const REPOSITORIES: Omit<SeedRepository, 'id'>[] = [
  { name: 'web-app', description: 'The customer web app', defaultRunMode: 'manual', setup: null },
  {
    name: 'api-scanned',
    description: 'An API that is scanned',
    defaultRunMode: 'auto_loop',
    setup: 'scanned',
  },
  {
    name: 'api-generating',
    description: 'An API whose setup is running',
    defaultRunMode: 'manual',
    setup: 'generating',
  },
  {
    name: 'api-pr-open',
    description: 'An API with an open setup pull request',
    defaultRunMode: 'manual',
    setup: 'pr_open',
  },
  {
    name: 'api-complete',
    description: 'An API whose setup merged',
    defaultRunMode: 'manual_plan',
    setup: 'complete',
  },
  {
    name: 'api-failed',
    description: 'An API whose setup failed',
    defaultRunMode: 'manual',
    setup: 'failed',
  },
  {
    name: 'api-unmovable',
    description: 'An API with loose skill files',
    defaultRunMode: 'manual',
    setup: 'unmovable',
  },
  // The repository the intake journey's local remote serves.
  {
    name: 'app',
    description: 'The app the intake journey uses',
    defaultRunMode: 'manual',
    setup: null,
  },
];

export const SEED_REPOSITORIES: SeedRepository[] = REPOSITORIES.map((repository, index) => ({
  id: repositoryId(index),
  ...repository,
}));

/** The run id of a seeded setup, derived from its repository. */
export const seedRunId = (repository: SeedRepository) =>
  repository.id.replace('-0000-7000-', '-0001-7000-');
