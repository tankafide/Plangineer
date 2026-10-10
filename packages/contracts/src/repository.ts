import { z } from 'zod';
import { base } from './base.ts';
import { GithubFailed } from './github-failed.ts';
import { PageInput, pageOutput } from './pagination.ts';
import { RepositoryScan, SelectionError, SetupSelection, SetupStatus } from './repository-setup.ts';
import { RunStatus } from './run.ts';
import { RunMode } from './run-mode.ts';

export const GithubRepositoryId = z.int().min(1);

export const AgentRole = z.enum([
  'pre_planning',
  'planning',
  'plan_review',
  'implementation',
  'implementation_review',
  'verification',
]);
export type AgentRole = z.infer<typeof AgentRole>;

export const RoleSetting = z.strictObject({
  agent: z.enum(['claude_code']),
  /** Null runs the CLI's default model. */
  model: z
    .string()
    .regex(/^[A-Za-z0-9._[\]-]{1,100}$/, 'must be a model name')
    .nullable(),
  runsOn: z.enum(['local_runner']),
  signIn: z.enum(['engineer_login']),
});
export type RoleSetting = z.infer<typeof RoleSetting>;

export const RoleSettings = z.strictObject({
  pre_planning: RoleSetting,
  planning: RoleSetting,
  plan_review: RoleSetting,
  implementation: RoleSetting,
  implementation_review: RoleSetting,
  verification: RoleSetting,
});
export type RoleSettings = z.infer<typeof RoleSettings>;

const RepositoryDescription = z.string().min(1).max(200);

const SetupRun = z.object({ id: z.uuid(), status: RunStatus, startedByViewer: z.boolean() });

const SetupView = z.object({
  status: SetupStatus,
  scan: RepositoryScan,
  selection: SetupSelection.nullable(),
  run: SetupRun.nullable(),
  pullRequest: z.object({ number: z.int(), url: z.url() }).nullable(),
  failureMessage: z.string().nullable(),
  updatedAt: z.iso.datetime(),
});

export const RepositoryDetail = z.object({
  id: z.uuid(),
  githubRepositoryId: GithubRepositoryId,
  owner: z.string(),
  name: z.string(),
  description: z.string(),
  roleSettings: RoleSettings,
  defaultRunMode: RunMode,
  setup: SetupView.nullable(),
  createdAt: z.iso.datetime(),
});
export type RepositoryDetail = z.infer<typeof RepositoryDetail>;

export const RepositorySummary = z.object({
  id: z.uuid(),
  owner: z.string(),
  name: z.string(),
  description: z.string(),
  defaultRunMode: RunMode,
  setupStatus: SetupStatus.nullable(),
});
export type RepositorySummary = z.infer<typeof RepositorySummary>;

export const InstallableRepository = z.object({
  installationId: z.int().min(1),
  githubRepositoryId: GithubRepositoryId,
  owner: z.string(),
  name: z.string(),
  private: z.boolean(),
});
export type InstallableRepository = z.infer<typeof InstallableRepository>;

export const INSTALLABLE_REPOSITORIES_MAX = 1_000;

export const RepositoryListInstallableOutput = z.object({
  items: z.array(InstallableRepository).max(INSTALLABLE_REPOSITORIES_MAX),
  truncated: z.boolean(),
  /** The App's GitHub page for choosing the repositories it may reach. */
  installUrl: z.url(),
});
export type RepositoryListInstallableOutput = z.infer<typeof RepositoryListInstallableOutput>;

export const RepositoryAddInput = z.strictObject({
  githubRepositoryId: GithubRepositoryId,
  description: RepositoryDescription,
});
export type RepositoryAddInput = z.infer<typeof RepositoryAddInput>;

const RepositoryIdInput = z.strictObject({ repositoryId: z.uuid() });

export const RepositoryUpdateInput = z
  .strictObject({
    repositoryId: z.uuid(),
    description: RepositoryDescription.optional(),
    roleSettings: RoleSettings.optional(),
    defaultRunMode: RunMode.optional(),
  })
  .refine(
    (input) =>
      input.description !== undefined ||
      input.roleSettings !== undefined ||
      input.defaultRunMode !== undefined,
    'must change at least one field',
  );
export type RepositoryUpdateInput = z.infer<typeof RepositoryUpdateInput>;

export const SetupStartInput = z.strictObject({
  repositoryId: z.uuid(),
  runnerId: z.uuid(),
  selection: SetupSelection,
});
export type SetupStartInput = z.infer<typeof SetupStartInput>;

export const InvalidSelectionData = z.object({
  reason: SelectionError,
  names: z.array(z.string()).max(200),
});
export type InvalidSelectionData = z.infer<typeof InvalidSelectionData>;

const NotFound = { status: 404 };
const Conflict = { status: 409 };

export const repositoryListInstallable = base
  .errors({ GITHUB_FAILED: GithubFailed })
  .output(RepositoryListInstallableOutput);

export const repositoryAdd = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict, GITHUB_FAILED: GithubFailed })
  .input(RepositoryAddInput)
  .output(RepositoryDetail);

export const repositoryList = base.input(PageInput).output(pageOutput(RepositorySummary));

export const repositoryGet = base
  .errors({ NOT_FOUND: NotFound })
  .input(RepositoryIdInput)
  .output(RepositoryDetail);

export const repositoryUpdate = base
  .errors({ NOT_FOUND: NotFound })
  .input(RepositoryUpdateInput)
  .output(RepositoryDetail);

export const repositoryRemove = base
  .errors({ NOT_FOUND: NotFound, CONFLICT: Conflict })
  .input(RepositoryIdInput)
  .output(z.object({ repositoryId: z.uuid() }));

export const repositorySetupScan = base
  .errors({
    NOT_FOUND: NotFound,
    CONFLICT: Conflict,
    GITHUB_FAILED: GithubFailed,
    REPOSITORY_TOO_LARGE: { status: 422 },
  })
  .input(RepositoryIdInput)
  .output(RepositoryDetail);

export const repositorySetupStart = base
  .errors({
    NOT_FOUND: NotFound,
    CONFLICT: Conflict,
    INVALID_SELECTION: { status: 422, data: InvalidSelectionData },
  })
  .input(SetupStartInput)
  .output(RepositoryDetail);

export const repositorySetupRefresh = base
  .errors({ NOT_FOUND: NotFound, GITHUB_FAILED: GithubFailed })
  .input(RepositoryIdInput)
  .output(RepositoryDetail);
