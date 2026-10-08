import {
  DEFAULT_WORKFLOW_SETTINGS,
  RepositoryScan,
  RoleSettings,
  RunEvent,
  type RunEventBody,
  type RunStatus,
  type SetupStatus,
  SetupJob,
  SetupSelection,
  WorkflowSettings,
} from '@plangineer/contracts';
import { renderSetupFiles, renderSetupInputs, renderSetupPrompt } from '../setup/setup-files.ts';
import type { Database } from './client.ts';
import {
  SEED_AT,
  SEED_COMMIT,
  SEED_REPOSITORIES,
  SEED_ROLE_SETTINGS,
  SEED_RUNNER_ID,
  SEED_RUNNER_TOKEN_HASH,
  SEED_SELECTION,
  SEED_USERS,
  seedRunId,
  seedScan,
  type SeedRepository,
} from './seed-data.ts';
import { repositories, repositorySetups, runEvents, runners, runs, user } from './schema.ts';
import { SEED_USER_IDS } from './seed-ids.ts';

const CLAUDE = {
  name: 'claude-code',
  version: '2.1.284',
  available: true,
  minimumVersion: '2.1.284',
} as const;

function seedJob(repository: SeedRepository): SetupJob {
  const scan = seedScan();
  const rendered = renderSetupFiles(scan, SEED_SELECTION);
  return SetupJob.parse({
    kind: 'setup',
    repository: { owner: 'acme', name: repository.name },
    commit: SEED_COMMIT,
    defaultBranch: scan.defaultBranch,
    prompt: renderSetupPrompt(),
    inputs: renderSetupInputs(scan, SEED_SELECTION),
    files: rendered.files,
    moveSkills: ['legacy-review'],
    templateSkills: rendered.templateSkills,
    generateSkills: rendered.generateSkills,
  });
}

/** The events a seeded setup run holds, as the API and its runner would have appended them. */
function runEventBodies(status: RunStatus): RunEventBody[] {
  const queued: RunEventBody[] = [{ type: 'run.queued' }];
  if (status === 'queued') return queued;
  const started: RunEventBody[] = [
    ...queued,
    { type: 'run.leased', runnerId: SEED_RUNNER_ID, attempt: 1 },
    { type: 'run.started', commit: SEED_COMMIT, cli: { name: 'claude-code', version: '2.1.284' } },
  ];
  if (status === 'failed') {
    return [
      ...started,
      {
        type: 'run.failed',
        reason: 'setup_invalid_output',
        message: 'backend: frontmatter name must equal the folder name',
        exitCode: null,
        stderrTail: [],
      },
    ];
  }
  return [
    ...started,
    {
      type: 'setup.pushed',
      branch: 'plangineer/setup',
      commit: 'beef'.repeat(10),
      changedPaths: ['.agents/skills/testing/SKILL.md', '.gitattributes'],
      changedPathCount: 2,
    },
    {
      type: 'run.succeeded',
      resultText: 'testing: sources and review notes.',
      truncated: false,
      costUsd: null,
      durationMs: 600_000,
      numTurns: 40,
    },
  ];
}

/** The run each started setup status has. */
const RUN_STATUS: Record<Exclude<SetupStatus, 'scanned'>, RunStatus> = {
  generating: 'queued',
  pr_open: 'succeeded',
  complete: 'succeeded',
  failed: 'failed',
};

async function seedRun(db: Database, repository: SeedRepository, status: RunStatus, job: SetupJob) {
  const runId = seedRunId(repository);
  const bodies = runEventBodies(status);
  const ended = status === 'queued' ? null : SEED_AT;
  const inserted = await db
    .insert(runs)
    .values({
      id: runId,
      kind: 'setup',
      userId: SEED_USER_IDS.admin,
      runnerId: SEED_RUNNER_ID,
      repositoryOwner: job.repository.owner,
      repositoryName: job.repository.name,
      ref: job.commit,
      prompt: job.prompt,
      status,
      attempt: status === 'queued' ? 0 : 1,
      lastEventId: bodies.length,
      commit: status === 'queued' ? null : SEED_COMMIT,
      startedAt: status === 'succeeded' ? SEED_AT : null,
      endedAt: ended,
      createdAt: SEED_AT,
    })
    .onConflictDoNothing()
    .returning({ id: runs.id });
  if (inserted.length === 0) return runId;
  await db.insert(runEvents).values(
    bodies.map((body, index) => {
      const fromRunner = !['run.queued', 'run.leased'].includes(body.type);
      return {
        runId,
        eventId: index + 1,
        attempt: status === 'queued' ? 0 : 1,
        runnerSeq: fromRunner ? index - 1 : null,
        type: body.type,
        payload: RunEvent.parse({ ...body, id: index + 1, runId, at: SEED_AT.toISOString() }),
        createdAt: SEED_AT,
      };
    }),
  );
  return runId;
}

async function seedSetup(db: Database, repository: SeedRepository): Promise<void> {
  if (repository.setup === null) return;
  const base = {
    repositoryId: repository.id,
    scan: RepositoryScan.parse(
      seedScan(repository.setup === 'unmovable' ? ['.claude/skills/notes.md'] : []),
    ),
    createdAt: SEED_AT,
    updatedAt: SEED_AT,
  };
  if (repository.setup === 'scanned' || repository.setup === 'unmovable') {
    await db
      .insert(repositorySetups)
      .values({ ...base, status: 'scanned' })
      .onConflictDoNothing();
    return;
  }
  const job = seedJob(repository);
  const runId = await seedRun(db, repository, RUN_STATUS[repository.setup], job);
  const opened = repository.setup === 'pr_open' || repository.setup === 'complete';
  await db
    .insert(repositorySetups)
    .values({
      ...base,
      status: repository.setup,
      selection: SetupSelection.parse(SEED_SELECTION),
      job,
      runId,
      pullRequestNumber: opened ? 12 : null,
      pullRequestUrl: opened ? `https://github.com/acme/${repository.name}/pull/12` : null,
      failureMessage:
        repository.setup === 'failed'
          ? 'backend: frontmatter name must equal the folder name'
          : null,
    })
    .onConflictDoNothing();
}

/**
 * Inserts the dev seed: two users, a runner that never connects, and one repository per setup
 * state. Ids and times are fixed, and a row that exists is skipped, so seeding twice adds nothing.
 * Rows go in directly, not through the repository modules, because those take no fixed ids or
 * times; each JSONB value is still parsed with its contract schema first.
 */
export async function seedDatabase(db: Database): Promise<void> {
  await db
    .insert(user)
    .values(
      SEED_USERS.map((seeded) => ({
        ...seeded,
        emailVerified: true,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(runners)
    .values({
      id: SEED_RUNNER_ID,
      userId: SEED_USER_IDS.admin,
      name: 'seed-runner',
      platform: 'linux',
      tokenHash: SEED_RUNNER_TOKEN_HASH,
      concurrencyLimit: 2,
      clis: [CLAUDE],
      createdAt: SEED_AT,
      updatedAt: SEED_AT,
    })
    .onConflictDoNothing();
  for (const repository of SEED_REPOSITORIES) {
    await db
      .insert(repositories)
      .values({
        id: repository.id,
        githubRepositoryId: Number.parseInt(repository.id.slice(-4), 10),
        githubInstallationId: 1,
        owner: 'acme',
        name: repository.name,
        description: repository.description,
        roleSettings: RoleSettings.parse(SEED_ROLE_SETTINGS),
        workflowSettings: WorkflowSettings.parse(DEFAULT_WORKFLOW_SETTINGS),
        createdBy: SEED_USER_IDS.admin,
        createdAt: SEED_AT,
        updatedAt: SEED_AT,
      })
      .onConflictDoNothing();
    await seedSetup(db, repository);
  }
}
