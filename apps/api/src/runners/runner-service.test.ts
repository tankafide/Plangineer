import { call } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerPairingCodes, runners } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeRunner, storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { appendRunnerEvents, queueRun, runRow, startedEvent, storedEvents } from '../test/runs.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { claimRuns } from '../runs/dispatch.ts';
import { hashSecret } from './pairing.ts';

const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const createCode = (context: InitialContext) =>
  call(router.runner.createPairingCode, undefined, { context });

describe('runner procedures', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database.drop();
  });

  async function member() {
    const user = await storeUser(testAuth(database.db));
    const context: InitialContext = {
      ...testDeps(database.db),
      session: { user: { id: user.id, name: user.name, email: user.email, role: 'member' } },
    };
    return { id: user.id, context };
  }

  const publicContext = (): InitialContext => ({ ...testDeps(database.db), session: null });
  const pair = (code: string, name = 'workstation') =>
    call(router.runner.pair, { code, name, platform: 'linux' }, { context: publicContext() });

  describe('pairing', () => {
    it('pairs a runner once with a code and stores only the token hash', async () => {
      const { id: userId, context } = await member();

      const { code, expiresAt } = await createCode(context);
      const { runnerId, token } = await pair(code);

      expect(code).toMatch(CODE_FORMAT);
      expect(Date.parse(expiresAt)).toBeGreaterThan(Date.now());
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const [row] = await database.db.select().from(runners).where(eq(runners.id, runnerId));
      expect(row).toMatchObject({
        userId,
        name: 'workstation',
        platform: 'linux',
        status: 'active',
      });
      expect(row?.tokenHash).toBe(hashSecret(token));
      expect(JSON.stringify(row)).not.toContain(token);
      const [codeRow] = await database.db
        .select()
        .from(runnerPairingCodes)
        .where(eq(runnerPairingCodes.userId, userId));
      expect(codeRow?.usedAt).not.toBeNull();
      expect(JSON.stringify(codeRow)).not.toContain(code.replaceAll('-', ''));
    });

    it('accepts the code without dashes and in lower case', async () => {
      const { context } = await member();
      const { code } = await createCode(context);

      await expect(pair(code.replaceAll('-', '').toLowerCase())).resolves.toHaveProperty('token');
    });

    it('rejects a second use of a code', async () => {
      const { context } = await member();
      const { code } = await createCode(context);
      await pair(code);

      await expect(pair(code)).rejects.toMatchObject({ code: 'PAIRING_CODE_REJECTED' });
    });

    it('rejects an expired code', async () => {
      const { id: userId, context } = await member();
      const { code } = await createCode(context);
      await database.db
        .update(runnerPairingCodes)
        .set({ expiresAt: sql`now() - interval '1 second'` })
        .where(eq(runnerPairingCodes.userId, userId));

      await expect(pair(code)).rejects.toMatchObject({ code: 'PAIRING_CODE_REJECTED' });
    });

    it('rejects an unknown code with the same message', async () => {
      const { context } = await member();
      const { code } = await createCode(context);
      await pair(code);
      const reused: unknown = await pair(code).catch((error: unknown) => error);

      const unknown: unknown = await pair('ZZZZ-ZZZZ-ZZZZ').catch((error: unknown) => error);

      expect(unknown).toMatchObject({ code: 'PAIRING_CODE_REJECTED', status: 401 });
      expect(reused).toBeInstanceOf(Error);
      expect(unknown).toHaveProperty('message', reused instanceof Error ? reused.message : '');
    });

    it('rejects a sixth pairing code inside 10 minutes', async () => {
      const { context } = await member();
      for (let index = 0; index < 5; index += 1) await createCode(context);

      await expect(createCode(context)).rejects.toMatchObject({
        code: 'TOO_MANY_REQUESTS',
        status: 429,
      });
    });
  });

  describe('runner.list', () => {
    it("returns only the caller's runners, pages with nextCursor, and shows online", async () => {
      const { id: userId, context } = await member();
      const other = await member();
      await storeRunner(database.db, { userId: other.id });
      const offline = await storeRunner(database.db, {
        userId,
        lastSeenAt: new Date(Date.now() - 60_000),
      });
      const online = await storeRunner(database.db, { userId });
      const never = await storeRunner(database.db, { userId, lastSeenAt: null });

      const first = await call(router.runner.list, { limit: 2 }, { context });
      const second = await call(
        router.runner.list,
        { limit: 2, cursor: first.nextCursor ?? undefined },
        { context },
      );

      expect([...first.items, ...second.items].map((runner) => [runner.id, runner.online])).toEqual(
        [
          [never, false],
          [online, true],
          [offline, false],
        ],
      );
      expect(first.nextCursor).toBe(online);
      expect(second.nextCursor).toBeNull();
    });
  });

  describe('runner.revoke', () => {
    it('marks the runner revoked and cancels its queued, leased and running runs', async () => {
      const { id: userId, context } = await member();
      const runnerId = await storeRunner(database.db, { userId, concurrencyLimit: 2 });
      const deps = testDeps(database.db);
      const running = await queueRun(deps, userId, runnerId);
      const leased = await queueRun(deps, userId, runnerId);
      await claimRuns(deps, runnerId);
      await appendRunnerEvents(deps, running, [startedEvent]);
      const queued = await queueRun(deps, userId, runnerId);

      const runner = await call(router.runner.revoke, { runnerId }, { context });

      expect(runner).toMatchObject({ id: runnerId, status: 'revoked' });
      expect(runner.revokedAt).not.toBeNull();
      for (const runId of [running, leased, queued]) {
        expect((await runRow(database.db, runId)).status).toBe('cancelled');
        expect((await storedEvents(database.db, runId)).at(-1)?.payload).toMatchObject({
          type: 'run.cancelled',
          reason: 'runner_revoked',
        });
      }
    });

    it('returns a revoked runner unchanged on a second revoke', async () => {
      const { id: userId, context } = await member();
      const runnerId = await storeRunner(database.db, { userId });
      const first = await call(router.runner.revoke, { runnerId }, { context });

      expect(await call(router.runner.revoke, { runnerId }, { context })).toEqual(first);
    });

    it("returns NOT_FOUND for another user's runner", async () => {
      const { context } = await member();
      const other = await member();
      const runnerId = await storeRunner(database.db, { userId: other.id });

      await expect(call(router.runner.revoke, { runnerId }, { context })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
