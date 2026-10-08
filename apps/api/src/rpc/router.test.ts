import { call, ORPCError } from '@orpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { silentLogger, storeUser, testAuth, testEnv } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import type { InitialContext } from './context.ts';
import { router } from './router.ts';

const ID = '0199c1a2-7b3c-7d4e-8f90-a1b2c3d4e5f6';

describe('router', () => {
  let database: TestDatabase;
  const context = (session: InitialContext['session']): InitialContext => ({
    logger: silentLogger,
    db: database.db,
    env: testEnv(),
    session,
  });

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  describe('me.get', () => {
    it('returns the session user', async () => {
      const stored = await storeUser(testAuth(database.db), { name: 'Grace Hopper' });
      const sessionUser = { id: stored.id, name: stored.name, email: stored.email, role: 'member' };

      const result = await call(router.me.get, undefined, {
        context: context({ user: sessionUser }),
      });

      expect(result).toEqual(sessionUser);
    });
  });

  const repository = { owner: 'acme', name: 'app' };
  const SESSION_PROCEDURES = [
    ['me.get', () => call(router.me.get, undefined, { context: context(null) })],
    [
      'runner.createPairingCode',
      () => call(router.runner.createPairingCode, undefined, { context: context(null) }),
    ],
    ['runner.list', () => call(router.runner.list, {}, { context: context(null) })],
    [
      'runner.revoke',
      () => call(router.runner.revoke, { runnerId: ID }, { context: context(null) }),
    ],
    [
      'run.create',
      () =>
        call(
          router.run.create,
          { runnerId: ID, repository, ref: 'main', prompt: 'Hi' },
          { context: context(null) },
        ),
    ],
    ['run.get', () => call(router.run.get, { runId: ID }, { context: context(null) })],
    ['run.list', () => call(router.run.list, {}, { context: context(null) })],
    ['run.cancel', () => call(router.run.cancel, { runId: ID }, { context: context(null) })],
  ] as const;

  it.each(SESSION_PROCEDURES)('%s throws UNAUTHORIZED without a session', async (_name, invoke) => {
    const result = invoke();

    await expect(result).rejects.toThrow(ORPCError);
    await expect(result).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 });
  });

  it('runner.pair needs no session, and rejects an unknown code', async () => {
    const result = call(
      router.runner.pair,
      { code: 'ABCD-EFGH-JKMN', name: 'workstation', platform: 'linux' },
      { context: context(null) },
    );

    await expect(result).rejects.toMatchObject({ code: 'PAIRING_CODE_REJECTED', status: 401 });
  });
});
