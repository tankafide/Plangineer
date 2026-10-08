import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKFLOW_SETTINGS,
  RepositoryAddInput,
  RepositoryDetail,
  RepositoryUpdateInput,
  RoleSetting,
  WorkflowSettings,
} from './repository.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';
const AT = '2026-10-08T12:00:00.000Z';

const role = {
  agent: 'claude_code',
  model: null,
  runsOn: 'local_runner',
  signIn: 'engineer_login',
};
const roleSettings = {
  pre_planning: role,
  planning: role,
  plan_review: role,
  implementation: role,
  implementation_review: role,
  verification: role,
};

function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    githubRepositoryId: 42,
    owner: 'acme',
    name: 'app',
    description: 'The web app',
    roleSettings,
    workflowSettings: DEFAULT_WORKFLOW_SETTINGS,
    setup: null,
    createdAt: AT,
    ...overrides,
  };
}

describe('RoleSetting', () => {
  it.each([role, { ...role, model: 'claude-opus-5-5' }, { ...role, model: 'opus[1m]' }])(
    'accepts %o',
    (setting) => {
      expect(RoleSetting.safeParse(setting).success).toBe(true);
    },
  );

  it.each([
    { ...role, agent: 'codex' },
    { ...role, model: '' },
    { ...role, model: 'a b' },
    { ...role, model: 'x'.repeat(101) },
    { ...role, runsOn: 'hosted_runner' },
  ])('rejects %o', (setting) => {
    expect(RoleSetting.safeParse(setting).success).toBe(false);
  });
});

const settings = (implementationReview: unknown) => ({
  ...DEFAULT_WORKFLOW_SETTINGS,
  implementationReview,
});

describe('WorkflowSettings', () => {
  it.each([
    DEFAULT_WORKFLOW_SETTINGS,
    settings({ findings: 'fix_all', rounds: { mode: 'fixed', count: 5 } }),
    settings({ findings: 'ask', rounds: { mode: 'adaptive', max: 1 } }),
  ])('accepts %o', (value) => {
    expect(WorkflowSettings.safeParse(value).success).toBe(true);
  });

  it.each([
    settings({ findings: 'ask', rounds: { mode: 'fixed', count: 6 } }),
    settings({ findings: 'ask', rounds: { mode: 'adaptive', max: 0 } }),
    settings({ findings: 'ask', rounds: { mode: 'ask', count: 2 } }),
    settings({ findings: 'auto', rounds: { mode: 'ask' } }),
    { ...DEFAULT_WORKFLOW_SETTINGS, planCheckIn: 'always' },
  ])('rejects %o', (value) => {
    expect(WorkflowSettings.safeParse(value).success).toBe(false);
  });
});

describe('RepositoryAddInput', () => {
  it.each([
    { githubRepositoryId: 0, description: 'x' },
    { githubRepositoryId: 1, description: '' },
    { githubRepositoryId: 1, description: 'x'.repeat(201) },
  ])('rejects %o', (input) => {
    expect(RepositoryAddInput.safeParse(input).success).toBe(false);
  });
});

describe('RepositoryUpdateInput', () => {
  it('accepts one field', () => {
    expect(RepositoryUpdateInput.safeParse({ repositoryId: ID, description: 'x' }).success).toBe(
      true,
    );
  });

  it('rejects an update that changes nothing', () => {
    expect(RepositoryUpdateInput.safeParse({ repositoryId: ID }).success).toBe(false);
  });
});

describe('RepositoryDetail', () => {
  it('accepts a repository with a setup', () => {
    const setup = {
      status: 'pr_open',
      scan: {
        commit: 'a'.repeat(40),
        defaultBranch: 'main',
        scannedAt: AT,
        skills: [],
        orchestratorReferences: [],
        unmovableContent: [],
        instructionFiles: [],
        recommendations: [],
      },
      selection: { reuseSkills: [], addSkills: ['testing'], orchestrators: [] },
      run: { id: ID, status: 'succeeded', startedByViewer: true },
      pullRequest: { number: 7, url: 'https://github.com/acme/app/pull/7' },
      failureMessage: null,
      updatedAt: AT,
    };
    expect(RepositoryDetail.parse(detail({ setup }))).toEqual(detail({ setup }));
  });

  it('strips an unknown key', () => {
    expect(RepositoryDetail.parse(detail({ githubInstallationId: 9 }))).toEqual(detail());
  });
});
