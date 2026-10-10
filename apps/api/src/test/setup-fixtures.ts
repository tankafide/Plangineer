import {
  type RepositoryScan,
  type RoleSetting,
  type RoleSettings,
  type SetupJob,
  type SetupSelection,
} from '@plangineer/contracts';
import type { Database } from '../db/client.ts';
import { repositories } from '../db/schema.ts';

const ROLE: RoleSetting = {
  agent: 'claude_code',
  model: null,
  runsOn: 'local_runner',
  signIn: 'engineer_login',
};

export const DEFAULT_ROLE_SETTINGS: RoleSettings = {
  pre_planning: ROLE,
  planning: ROLE,
  plan_review: ROLE,
  implementation: ROLE,
  implementation_review: ROLE,
  verification: ROLE,
};

export function testScan(overrides: Partial<RepositoryScan> = {}): RepositoryScan {
  return {
    commit: 'c'.repeat(40),
    defaultBranch: 'main',
    scannedAt: '2026-10-08T12:00:00.000Z',
    skills: [],
    orchestratorReferences: [],
    unmovableContent: [],
    instructionFiles: [],
    recommendations: [],
    ...overrides,
  };
}

export function testSelection(overrides: Partial<SetupSelection> = {}): SetupSelection {
  return { reuseSkills: [], addSkills: ['testing'], orchestrators: [], ...overrides };
}

export function testSetupJob(overrides: Partial<SetupJob> = {}): SetupJob {
  return {
    kind: 'setup',
    repository: { owner: 'acme', name: 'app' },
    commit: 'c'.repeat(40),
    defaultBranch: 'main',
    prompt: 'Finish the skills.',
    inputs: '# Inputs',
    files: [],
    moveSkills: [],
    templateSkills: [],
    generateSkills: [],
    ...overrides,
  };
}

type RepositoryRow = typeof repositories.$inferInsert;

/** Inserts a repository row directly, so setup tests need no GitHub call to add one. */
export async function storeRepository(
  db: Database,
  overrides: Partial<RepositoryRow> & { createdBy: string },
): Promise<string> {
  const [row] = await db
    .insert(repositories)
    .values({
      githubRepositoryId: 1001,
      githubInstallationId: 1,
      owner: 'acme',
      name: 'app',
      description: 'The web app',
      roleSettings: DEFAULT_ROLE_SETTINGS,
      defaultBranch: 'main',
      ...overrides,
    })
    .returning({ id: repositories.id });
  if (row === undefined) throw new Error('Repository insert returned no row');
  return row.id;
}
