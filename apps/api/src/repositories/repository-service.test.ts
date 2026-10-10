import { call } from '@orpc/server';
import { count, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { features, repositories, repositorySetups } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { storeFeature } from '../test/features.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import {
  DEFAULT_ROLE_SETTINGS,
  storeRepository,
  testScan,
  testSelection,
  testSetupJob,
} from '../test/setup-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

describe('repository procedures', () => {
  let database: TestDatabase;
  let fake: FakeGithub;
  let admin: InitialContext;
  let member: InitialContext;

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
    const auth = testAuth(database.db);
    const context = async (role: 'admin' | 'member'): Promise<InitialContext> => {
      const stored = await storeUser(auth, { role });
      return {
        ...testDeps(database.db),
        session: { user: { id: stored.id, name: stored.name, email: stored.email, role } },
      };
    };
    admin = await context('admin');
    member = await context('member');
  });

  beforeEach(async () => {
    await database.db.delete(features);
    await database.db.delete(repositories);
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  const repositoryCount = async () =>
    (await database.db.select({ n: count() }).from(repositories))[0]?.n;

  it('adds an installable repository as Manual on its default branch, with the default role settings', async () => {
    fake.repositories.push(
      fakeRepository({
        id: 77,
        installationId: 5,
        owner: 'acme',
        name: 'web',
        defaultBranch: 'trunk',
      }),
    );

    const added = await call(
      router.repository.add,
      { githubRepositoryId: 77, description: 'The web app' },
      { context: admin },
    );
    const listed = await call(router.repository.list, {}, { context: member });
    const fetched = await call(
      router.repository.get,
      { repositoryId: added.id },
      { context: member },
    );

    expect(added).toMatchObject({
      githubRepositoryId: 77,
      owner: 'acme',
      name: 'web',
      description: 'The web app',
      roleSettings: DEFAULT_ROLE_SETTINGS,
      defaultRunMode: 'manual',
      setup: null,
    });
    expect(added).not.toHaveProperty('workflowSettings');
    expect(listed.items).toEqual([
      {
        id: added.id,
        owner: 'acme',
        name: 'web',
        description: 'The web app',
        defaultRunMode: 'manual',
        setupStatus: null,
      },
    ]);
    expect(fetched).toEqual(added);
    const [row] = await database.db
      .select({
        installationId: repositories.githubInstallationId,
        defaultBranch: repositories.defaultBranch,
      })
      .from(repositories);
    expect(row).toEqual({ installationId: 5, defaultBranch: 'trunk' });
  });

  const add = (githubRepositoryId: number) =>
    call(router.repository.add, { githubRepositoryId, description: 'x' }, { context: admin });

  it('returns NOT_FOUND for a repository the App cannot reach, and CONFLICT for one added twice', async () => {
    fake.repositories.push(fakeRepository({ id: 77 }));

    await expect(add(78)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await add(77);
    await expect(add(77)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await repositoryCount()).toBe(1);
  });

  it('lists installable repositories not yet added, by owner then name, with the install URL', async () => {
    fake.repositories.push(
      fakeRepository({ id: 1, owner: 'zeta', name: 'a' }),
      fakeRepository({ id: 2, owner: 'acme', name: 'web' }),
      fakeRepository({ id: 3, owner: 'acme', name: 'api', installationId: 2 }),
    );
    await storeRepository(database.db, {
      createdBy: admin.session?.user.id ?? '',
      githubRepositoryId: 1,
    });

    const installable = await call(router.repository.listInstallable, undefined, {
      context: admin,
    });

    expect(installable).toEqual({
      items: [
        { installationId: 2, githubRepositoryId: 3, owner: 'acme', name: 'api', private: true },
        { installationId: 1, githubRepositoryId: 2, owner: 'acme', name: 'web', private: true },
      ],
      truncated: false,
      installUrl: 'https://github.com/apps/plangineer-test/installations/new',
    });
  });

  it('returns the first 1,000 installable repositories and marks the list truncated', async () => {
    for (let index = 0; index < 1_001; index += 1) {
      fake.repositories.push(
        fakeRepository({ id: 10_000 + index, name: `repo-${String(index).padStart(4, '0')}` }),
      );
    }

    const installable = await call(router.repository.listInstallable, undefined, {
      context: admin,
    });

    expect(installable.items).toHaveLength(1_000);
    expect(installable.items.at(-1)?.name).toBe('repo-0999');
    expect(installable.truncated).toBe(true);
  });

  it('updates the description, one role model and the default run mode, which the list shows', async () => {
    const repositoryId = await storeRepository(database.db, {
      createdBy: admin.session?.user.id ?? '',
    });
    const roleSettings = {
      ...DEFAULT_ROLE_SETTINGS,
      planning: { ...DEFAULT_ROLE_SETTINGS.planning, model: 'claude-opus-5-5' },
    };

    const updated = await call(
      router.repository.update,
      { repositoryId, description: 'New words', roleSettings, defaultRunMode: 'auto_loop' },
      { context: admin },
    );
    const listed = await call(router.repository.list, {}, { context: member });

    expect(updated).toMatchObject({
      description: 'New words',
      roleSettings,
      defaultRunMode: 'auto_loop',
    });
    expect(listed.items).toEqual([expect.objectContaining({ defaultRunMode: 'auto_loop' })]);
  });

  it('removes a repository and its setup, and refuses while the setup is generating or a feature involves it', async () => {
    const createdBy = admin.session?.user.id ?? '';
    const idle = await storeRepository(database.db, { createdBy, githubRepositoryId: 1 });
    const busy = await storeRepository(database.db, { createdBy, githubRepositoryId: 2 });
    const involved = await storeRepository(database.db, { createdBy, githubRepositoryId: 3 });
    await storeFeature(database.db, { authorId: createdBy, repositoryId: involved });
    await database.db.insert(repositorySetups).values([
      { repositoryId: idle, status: 'scanned', scan: testScan() },
      {
        repositoryId: busy,
        status: 'generating',
        scan: testScan(),
        selection: testSelection(),
        job: testSetupJob(),
      },
    ]);
    const remove = (repositoryId: string) =>
      call(router.repository.remove, { repositoryId }, { context: admin });

    await expect(remove(idle)).resolves.toEqual({ repositoryId: idle });
    await expect(remove(busy)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(remove(involved)).rejects.toMatchObject({ code: 'CONFLICT', status: 409 });
    const setups = await database.db
      .select({ repositoryId: repositorySetups.repositoryId })
      .from(repositorySetups);
    expect(setups).toEqual([{ repositoryId: busy }]);
    expect(await repositoryCount()).toBe(2);
  });

  it.each(['listInstallable', 'add'] as const)(
    'returns GITHUB_FAILED with GitHub status and message when %s fails',
    async (procedure) => {
      fake.repositories.push(fakeRepository());
      fake.fail(/\/installation\/repositories/, 403, 'API rate limit exceeded');

      const result =
        procedure === 'add'
          ? call(
              router.repository.add,
              { githubRepositoryId: 1001, description: 'x' },
              { context: admin },
            )
          : call(router.repository.listInstallable, undefined, { context: admin });

      await expect(result).rejects.toMatchObject({
        code: 'GITHUB_FAILED',
        data: { status: 403, message: expect.stringContaining('API rate limit exceeded') },
      });
    },
  );

  it.each([
    [
      'repository.add',
      () =>
        call(
          router.repository.add,
          { githubRepositoryId: 1, description: 'x' },
          { context: member },
        ),
    ],
    [
      'repository.listInstallable',
      () => call(router.repository.listInstallable, undefined, { context: member }),
    ],
  ])('refuses a member calling %s with FORBIDDEN and changes no row', async (_name, invoke) => {
    const before = await repositoryCount();

    await expect(invoke()).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(await repositoryCount()).toBe(before);
    expect(fake.tokenRequests).toEqual([]);
  });

  it('refuses a member removing a repository or changing its run mode with FORBIDDEN, and keeps it', async () => {
    const repositoryId = await storeRepository(database.db, {
      createdBy: admin.session?.user.id ?? '',
    });

    await expect(
      call(router.repository.remove, { repositoryId }, { context: member }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    await expect(
      call(
        router.repository.update,
        { repositoryId, defaultRunMode: 'auto_loop' },
        { context: member },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    const rows = await database.db
      .select({ defaultRunMode: repositories.defaultRunMode })
      .from(repositories);
    expect(rows).toEqual([{ defaultRunMode: 'manual' }]);
  });

  it('lets a member read a repository', async () => {
    const repositoryId = await storeRepository(database.db, {
      createdBy: admin.session?.user.id ?? '',
    });

    await expect(
      call(router.repository.get, { repositoryId }, { context: member }),
    ).resolves.toMatchObject({ id: repositoryId });
    const rows = await database.db
      .select({ id: repositories.id })
      .from(repositories)
      .where(eq(repositories.id, repositoryId));
    expect(rows).toHaveLength(1);
  });
});
