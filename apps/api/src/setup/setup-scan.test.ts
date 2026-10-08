import { call } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repositories, repositorySetups } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { blobSha, type FakeRepository, fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { storeRepository, testScan, testSelection, testSetupJob } from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const skill = (description: string) => `---\nname: x\ndescription: ${description}\n---\n\n# X\n`;

function repositoryWith(files: Record<string, string>, overrides: Partial<FakeRepository> = {}) {
  return fakeRepository({ files, ...overrides });
}

describe('repositorySetup.scan', () => {
  let database: TestDatabase;
  let fake: FakeGithub;
  let admin: InitialContext;
  let repositoryId: string;

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
    const stored = await storeUser(testAuth(database.db), { role: 'admin' });
    admin = {
      ...testDeps(database.db),
      session: { user: { id: stored.id, name: stored.name, email: stored.email, role: 'admin' } },
    };
  });

  beforeEach(async () => {
    repositoryId = await storeRepository(database.db, {
      createdBy: admin.session?.user.id ?? '',
      owner: 'old-owner',
      name: 'old-name',
    });
  });

  afterEach(async () => {
    fake.reset();
    await database.db.delete(repositorySetups);
    await database.db.delete(repositories);
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  const scan = () => call(router.repositorySetup.scan, { repositoryId }, { context: admin });

  async function storedSetup() {
    const [row] = await database.db
      .select()
      .from(repositorySetups)
      .where(eq(repositorySetups.repositoryId, repositoryId));
    return row;
  }

  it('stores the skills, instruction files and recommendations with status scanned', async () => {
    fake.repositories.push(
      repositoryWith(
        {
          '.agents/skills/testing/SKILL.md': skill('How we test.'),
          '.agents/skills/shared/SKILL.md': skill('Shared rules.'),
          '.claude/skills/shared/SKILL.md': skill('Shared rules.'),
          '.claude/skills/legacy/SKILL.md': skill('Old rules.'),
          'AGENTS.md': '# Agents',
          'web/CLAUDE.md': '# Claude',
          '.cursor/rules/style.mdc': 'rules',
          'node_modules/lib/AGENTS.md': '# Vendored',
          'package.json': JSON.stringify({ dependencies: { hono: '4' } }),
          'db/migrations/0001.sql': 'CREATE TABLE x ();',
        },
        { owner: 'acme', name: 'web' },
      ),
    );

    const detail = await scan();

    expect(detail).toMatchObject({ owner: 'acme', name: 'web' });
    expect(detail.setup?.status).toBe('scanned');
    expect(detail.setup?.scan).toMatchObject({
      commit: 'c'.repeat(40),
      defaultBranch: 'main',
      skills: [
        { name: 'legacy', description: 'Old rules.', location: 'claude' },
        { name: 'shared', description: 'Shared rules.', location: 'both' },
        { name: 'testing', description: 'How we test.', location: 'agents' },
      ],
      orchestratorReferences: [],
      unmovableContent: [],
      instructionFiles: ['.cursor/rules/style.mdc', 'AGENTS.md', 'web/CLAUDE.md'],
    });
    const recommendations = detail.setup?.scan.recommendations ?? [];
    expect(recommendations.map((item) => item.name)).not.toContain('testing');
    expect(recommendations.find((item) => item.name === 'backend')).toMatchObject({
      recommended: true,
      reason: 'Found `hono` in package.json',
    });
    expect(recommendations.find((item) => item.name === 'data-model-design')).toMatchObject({
      recommended: true,
      reason: 'Found a `migrations` folder',
    });
    expect((await storedSetup())?.status).toBe('scanned');
  });

  it('returns REPOSITORY_TOO_LARGE for a truncated tree and keeps the stored setup', async () => {
    fake.repositories.push(repositoryWith({ 'README.md': '#' }, { truncated: true }));
    await database.db
      .insert(repositorySetups)
      .values({ repositoryId, status: 'scanned', scan: testScan() });
    const before = await storedSetup();

    await expect(scan()).rejects.toMatchObject({ code: 'REPOSITORY_TOO_LARGE' });
    expect(await storedSetup()).toEqual(before);
  });

  it('returns CONFLICT while the setup is generating', async () => {
    fake.repositories.push(repositoryWith({}));
    await database.db.insert(repositorySetups).values({
      repositoryId,
      status: 'generating',
      scan: testScan(),
      selection: testSelection(),
      job: testSetupJob(),
    });

    await expect(scan()).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it.each([
    ['failed', { status: 'failed' as const, failureMessage: 'Broke' }],
    [
      'pr_open',
      {
        status: 'pr_open' as const,
        pullRequestNumber: 7,
        pullRequestUrl: 'https://github.com/acme/app/pull/7',
      },
    ],
  ])('clears a %s setup on rescan', async (_status, state) => {
    fake.repositories.push(repositoryWith({}));
    await database.db.insert(repositorySetups).values({
      repositoryId,
      scan: testScan(),
      selection: testSelection(),
      job: testSetupJob(),
      ...state,
    });

    await scan();

    expect(await storedSetup()).toMatchObject({
      status: 'scanned',
      selection: null,
      job: null,
      runId: null,
      pullRequestNumber: null,
      pullRequestUrl: null,
      failureMessage: null,
    });
  });

  it('lists a loose file, an invalid folder and a file missing from a both copy as unmovable', async () => {
    fake.repositories.push(
      repositoryWith({
        '.claude/skills/notes.md': 'loose',
        '.claude/skills/Bad_Name/SKILL.md': skill('Bad.'),
        '.agents/skills/shared/SKILL.md': skill('Shared.'),
        '.claude/skills/shared/SKILL.md': skill('Shared.'),
        '.claude/skills/shared/extra.md': 'only in the mirror',
        '.claude/skills/legacy/SKILL.md': skill('Moves.'),
        '.claude/skills/legacy/notes.md': 'moves with it',
        '.agents/skills/orchestrator-references/review-loop.md': '# Loop',
        '.claude/skills/orchestrator-references/review-loop.md': '# Loop',
      }),
    );

    const detail = await scan();

    expect(detail.setup?.scan.unmovableContent).toEqual([
      '.claude/skills/Bad_Name/SKILL.md',
      '.claude/skills/notes.md',
      '.claude/skills/shared/extra.md',
    ]);
    expect(detail.setup?.scan.orchestratorReferences).toEqual(['review-loop.md']);
  });

  it('stores a SKILL.md over 256 KiB with no description and never reads it, and skips a long instruction path', async () => {
    const large = skill('Too big.');
    const longPath = `${'deep/'.repeat(60)}AGENTS.md`;
    fake.repositories.push(
      repositoryWith(
        { '.agents/skills/huge/SKILL.md': large, [longPath]: '#', 'AGENTS.md': '#' },
        { sizes: { '.agents/skills/huge/SKILL.md': 256 * 1024 + 1 } },
      ),
    );

    const detail = await scan();

    expect(detail.setup?.scan.skills).toEqual([
      { name: 'huge', description: null, location: 'agents' },
    ]);
    expect(fake.blobReads).not.toContain(blobSha(large));
    expect(detail.setup?.scan.instructionFiles).toEqual(['AGENTS.md']);
  });

  it('returns REPOSITORY_TOO_LARGE for 201 skills', async () => {
    const files = Object.fromEntries(
      Array.from({ length: 201 }, (_, index) => [
        `.agents/skills/skill-${index}/SKILL.md`,
        skill(`Skill ${index}.`),
      ]),
    );
    fake.repositories.push(repositoryWith(files));

    await expect(scan()).rejects.toMatchObject({ code: 'REPOSITORY_TOO_LARGE' });
  });

  it('reads no names from invalid or oversized package.json files, and reads only the first 50', async () => {
    const manifests = Object.fromEntries(
      Array.from({ length: 51 }, (_, index) => [
        `pkg-${String(index).padStart(2, '0')}/package.json`,
        JSON.stringify({ name: `pkg-${index}`, dependencies: index === 50 ? { react: '19' } : {} }),
      ]),
    );
    fake.repositories.push(
      repositoryWith(
        {
          ...manifests,
          'a-broken/package.json': '{ "dependencies": { "hono": ',
          'a-large/package.json': JSON.stringify({ dependencies: { prisma: '6' } }),
        },
        { sizes: { 'a-large/package.json': 1024 * 1024 + 1 } },
      ),
    );

    const detail = await scan();

    const recommended = (name: string) =>
      detail.setup?.scan.recommendations.find((item) => item.name === name)?.recommended;
    expect(recommended('backend')).toBe(false);
    expect(recommended('database-access')).toBe(false);
    expect(recommended('frontend')).toBe(false);
    expect(fake.blobReads).not.toContain(blobSha(manifests['pkg-50/package.json'] ?? ''));
  });

  it('returns GITHUB_FAILED and keeps the stored setup when GitHub fails', async () => {
    fake.repositories.push(repositoryWith({}));
    fake.fail(/\/git\/trees\//, 500, 'Server Error');
    await database.db
      .insert(repositorySetups)
      .values({ repositoryId, status: 'scanned', scan: testScan() });
    const before = await storedSetup();

    await expect(scan()).rejects.toMatchObject({
      code: 'GITHUB_FAILED',
      data: { status: 500, message: expect.stringContaining('Server Error') },
    });
    expect(await storedSetup()).toEqual(before);
  });

  it('stores one setup row for two concurrent first scans, and neither fails', async () => {
    fake.repositories.push(repositoryWith({ 'README.md': '#' }));

    const results = await Promise.all([scan(), scan()]);

    expect(results.map((detail) => detail.setup?.status)).toEqual(['scanned', 'scanned']);
    const rows = await database.db
      .select({ id: repositorySetups.id })
      .from(repositorySetups)
      .where(eq(repositorySetups.repositoryId, repositoryId));
    expect(rows).toHaveLength(1);
  });
});
