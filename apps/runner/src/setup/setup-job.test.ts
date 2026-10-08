import type { SetupJob } from '@plangineer/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunnerEnv } from '../config/runner-env.ts';
import { packageVersion } from '../package-version.ts';
import type { Runner } from '../start-command.ts';
import { type FakeControlPlane, startFakeControlPlane } from '../test/fake-control-plane.ts';
import {
  CLAUDE_ONLY_SKILLS,
  createGitRemote,
  type GitRemote,
  SYNCED_SKILLS,
} from '../test/git-remote.ts';
import {
  isMessage,
  removeDataDir,
  startTestRunner,
  TEST_REPOSITORY,
  testRunnerEnv,
} from '../test/test-runner.ts';

const PROJECT_STACK = [
  '---',
  'name: project-stack',
  'description: The stack.',
  'disable-model-invocation: true',
  '---',
  '',
  '# Project stack',
  '',
  '## Stack',
  '',
  '<!-- slot: fact stack: the stack -->',
  '',
].join('\n');
const POLICY = 'policy:\n  allow_implicit_invocation: false\n';
const ORCHESTRATOR =
  '---\nname: plan-orchestrator\ndescription: Plans.\n---\n\n# Plan\n\nRead [project-stack](../project-stack/SKILL.md).\n';

let remote: GitRemote;
let commit: string;
let plane: FakeControlPlane;
let env: RunnerEnv;
let runner: Runner | undefined;

beforeAll(async () => {
  remote = await createGitRemote(TEST_REPOSITORY);
  commit = await remote.commit({ ...SYNCED_SKILLS, ...CLAUDE_ONLY_SKILLS, 'README.md': 'app\n' });
  vi.stubEnv('GIT_AUTHOR_NAME', 'Engineer');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'engineer@example.com');
  vi.stubEnv('GIT_COMMITTER_NAME', 'Engineer');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'engineer@example.com');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await remote.cleanup();
});

beforeEach(async () => {
  plane = await startFakeControlPlane();
  env = await testRunnerEnv({ plane, gitBaseUrl: remote.baseUrl });
  runner = await startTestRunner(env, plane);
  await plane.waitFor(isMessage('hello'));
});

afterEach(async () => {
  runner?.shutdown();
  await runner?.exited;
  runner = undefined;
  await plane.stop();
  await removeDataDir(env);
});

function setupJob(scenario: string, overrides: Partial<SetupJob> = {}): SetupJob {
  return {
    kind: 'setup',
    repository: TEST_REPOSITORY,
    commit,
    defaultBranch: 'main',
    prompt: `fake:${scenario}\nFinish the skills.`,
    inputs: '# Inputs\n',
    files: [
      { path: '.agents/skills/project-stack/SKILL.md', content: PROJECT_STACK },
      { path: '.agents/skills/project-stack/agents/openai.yaml', content: POLICY },
      { path: '.agents/skills/plan-orchestrator/SKILL.md', content: ORCHESTRATOR },
    ],
    moveSkills: ['legacy'],
    templateSkills: ['project-stack'],
    generateSkills: ['backend'],
    ...overrides,
  };
}

/** Runs a job to its terminal event and returns the events it sent. */
async function runToEnd(job: SetupJob, terminal = 'run.succeeded') {
  const runId = plane.assign(job);
  await plane.waitFor(
    (message): message is never =>
      message.type === 'run.events' &&
      message.runId === runId &&
      message.events.some((entry) =>
        ['run.succeeded', 'run.failed', 'run.cancelled'].includes(entry.event.type),
      ),
  );
  const events = plane.events(runId).map((entry) => entry.event);
  expect(events.at(-1)?.type).toBe(terminal);
  return events;
}

describe('setup job', () => {
  it('pushes plangineer/setup with the moved, rendered, filled and generated skills', async () => {
    const events = await runToEnd(setupJob('setup-skills'));

    const pushed = events.find((event) => event.type === 'setup.pushed');
    expect(events.map((event) => event.type).slice(-2)).toEqual(['setup.pushed', 'run.succeeded']);
    const branch = await remote.branchCommit('plangineer/setup');
    expect(pushed).toMatchObject({ branch: 'plangineer/setup', commit: branch });
    const files = await remote.files('plangineer/setup');
    expect(Object.keys(files).filter((file) => file.startsWith('.plangineer-setup'))).toEqual([]);
    expect(files['.agents/skills/legacy/SKILL.md']).toBe(
      CLAUDE_ONLY_SKILLS['.claude/skills/legacy/SKILL.md'],
    );
    expect(files['.agents/skills/legacy/notes.md']).toBe(
      CLAUDE_ONLY_SKILLS['.claude/skills/legacy/notes.md'],
    );
    expect(files['.agents/skills/plan-orchestrator/SKILL.md']).toBe(ORCHESTRATOR);
    expect(files['.agents/skills/project-stack/SKILL.md']).toBe(
      PROJECT_STACK.replace('<!-- slot: fact stack: the stack -->', 'Filled by the fake agent.'),
    );
    expect(files['.agents/skills/backend/SKILL.md']).toContain('name: backend');
    expect(files['.claude/skills/backend/SKILL.md']).toBe(files['.agents/skills/backend/SKILL.md']);
    expect(files['.claude/skills/project-stack/agents/openai.yaml']).toBe(POLICY);
    expect(files['.gitattributes']).toBe('.claude/skills/** linguist-generated\n');
    expect(files['.github/workflows/plangineer-skills.yml']).toContain(
      `npx --yes plangineer-runner@${packageVersion()} skills check`,
    );
    expect(files['.github/workflows/plangineer-skills.yml']).toContain("branches: ['main']");
    expect(pushed).toMatchObject({ changedPathCount: expect.any(Number) });
  });

  it('fails an invalid generated skill with setup_invalid_output and pushes nothing', async () => {
    const before = await remote.branchCommit('plangineer/setup');
    const events = await runToEnd(setupJob('setup-invalid-skill'), 'run.failed');

    expect(events.at(-1)).toMatchObject({
      reason: 'setup_invalid_output',
      message: expect.stringContaining('backend: frontmatter name must equal the folder name'),
    });
    expect(await remote.branchCommit('plangineer/setup')).toBe(before);
  });

  it.each([
    ['setup-edits-fixed-text', 'changed text outside its slots'],
    ['setup-leaves-slot', 'still has a slot line'],
    ['setup-edits-existing', '.agents/skills/alpha/SKILL.md was changed'],
    ['setup-outside-path', 'notes.txt'],
  ])(
    'fails the %s scenario with setup_invalid_output and pushes nothing',
    async (scenario, text) => {
      const before = await remote.branchCommit('plangineer/setup');

      const events = await runToEnd(setupJob(scenario), 'run.failed');

      expect(events.at(-1)).toMatchObject({
        reason: 'setup_invalid_output',
        message: expect.stringContaining(text),
      });
      expect(await remote.branchCommit('plangineer/setup')).toBe(before);
    },
  );

  it('fails when the agent did not write a generated skill', async () => {
    const events = await runToEnd(
      setupJob('setup-skills', { generateSkills: ['backend', 'frontend'] }),
      'run.failed',
    );

    expect(events.at(-1)).toMatchObject({
      reason: 'setup_invalid_output',
      message: expect.stringContaining('.agents/skills/frontend/SKILL.md was not written'),
    });
  });

  it('ends cancelled during the agent step and pushes nothing', async () => {
    const before = await remote.branchCommit('plangineer/setup');
    const runId = plane.assign(setupJob('hang'));
    await plane.waitForEvent(runId, 'agent.other');

    plane.cancel(runId);
    await plane.waitForEvent(runId, 'run.cancelled');

    expect(await remote.branchCommit('plangineer/setup')).toBe(before);
  });
});

describe('setup job pushes', () => {
  afterEach(async () => {
    await remote.config('receive.denyNonFastForwards', 'false');
  });

  it('force-pushes the branch again with the new commit on a second run', async () => {
    const first = (await runToEnd(setupJob('setup-skills'))).find(
      (event) => event.type === 'setup.pushed',
    );
    const second = (await runToEnd(setupJob('setup-skills'))).find(
      (event) => event.type === 'setup.pushed',
    );

    expect(second).toMatchObject({ commit: await remote.branchCommit('plangineer/setup') });
    expect(second).not.toMatchObject({
      commit: first?.type === 'setup.pushed' ? first.commit : '',
    });
  });

  it('fails a rejected push with setup_publish_failed and git stderr lines', async () => {
    await runToEnd(setupJob('setup-skills'));
    await remote.config('receive.denyNonFastForwards', 'true');

    const events = await runToEnd(setupJob('setup-skills'), 'run.failed');

    expect(events.at(-1)).toMatchObject({
      reason: 'setup_publish_failed',
      stderrTail: expect.arrayContaining([expect.stringContaining('non-fast-forward')]),
    });
  });
});
