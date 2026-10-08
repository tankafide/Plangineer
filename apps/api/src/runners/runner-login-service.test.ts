import { call } from '@orpc/server';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runnerLogins, runners } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { storeUser, testAuth, testDeps } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';
import { hashSecret } from './pairing.ts';

const CODE_FORMAT = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const get = (context: InitialContext, userCode: string) =>
  call(router.runner.getLogin, { userCode }, { context });
const approve = (context: InitialContext, userCode: string) =>
  call(router.runner.approveLogin, { userCode }, { context });
const deny = (context: InitialContext, userCode: string) =>
  call(router.runner.denyLogin, { userCode }, { context });

describe('runner login procedures', () => {
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
  const start = (name = 'workstation') =>
    call(router.runner.startLogin, { name, platform: 'linux' }, { context: publicContext() });
  const poll = (deviceSecret: string) =>
    call(router.runner.pollLogin, { deviceSecret }, { context: publicContext() });

  const loginOf = async (userCode: string) => {
    const [row] = await database.db
      .select()
      .from(runnerLogins)
      .where(eq(runnerLogins.userCodeHash, hashSecret(userCode.replaceAll('-', ''))));
    if (row === undefined) throw new Error('No login request for the user code');
    return row;
  };
  const expire = (userCode: string, interval = '1 second') =>
    database.db
      .update(runnerLogins)
      .set({ expiresAt: sql`now() - ${sql.raw(`interval '${interval}'`)}` })
      .where(eq(runnerLogins.userCodeHash, hashSecret(userCode.replaceAll('-', ''))));

  describe('startLogin', () => {
    it('returns the secrets once, an approval link and the poll interval, and stores hashes', async () => {
      const started = await start();

      expect(started.userCode).toMatch(CODE_FORMAT);
      expect(Buffer.from(started.deviceSecret, 'base64url')).toHaveLength(32);
      expect(started.approveUrl).toBe(
        `http://localhost:5173/runners/approve?code=${started.userCode}`,
      );
      expect(started.pollIntervalMs).toBe(2000);
      expect(Date.parse(started.expiresAt)).toBeGreaterThan(Date.now());
      const row = await loginOf(started.userCode);
      expect(row).toMatchObject({ name: 'workstation', status: 'pending', userId: null });
      expect(row.deviceSecretHash).toBe(hashSecret(started.deviceSecret));
      const stored = JSON.stringify(row);
      expect(stored).not.toContain(started.deviceSecret);
      expect(stored).not.toContain(started.userCode.replaceAll('-', ''));
    });

    it('refuses at 200 pending unexpired login requests, and counts neither expired nor decided ones', async () => {
      await database.db.delete(runnerLogins);
      const { context } = await member();
      const decided = await start();
      await approve(context, decided.userCode);
      const expired = await start();
      await expire(expired.userCode);
      await database.db.execute(sql`
        INSERT INTO runner_logins (device_secret_hash, user_code_hash, name, platform, expires_at)
        SELECT 'd' || n, 'u' || n, 'filler', 'linux', now() + interval '1 hour'
        FROM generate_series(1, 199) AS n`);

      await expect(start()).resolves.toHaveProperty('userCode');
      await expect(start()).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS', status: 429 });
      await database.db.delete(runnerLogins);
    });

    it('deletes login requests that expired more than an hour ago, and keeps newer ones', async () => {
      const old = await start();
      await expire(old.userCode, '61 minutes');
      const recent = await start();
      await expire(recent.userCode, '30 minutes');

      await start();

      const hashes = (await database.db.select().from(runnerLogins)).map((row) => row.userCodeHash);
      expect(hashes).not.toContain(hashSecret(old.userCode.replaceAll('-', '')));
      expect(hashes).toContain(hashSecret(recent.userCode.replaceAll('-', '')));
    });
  });

  describe('pollLogin', () => {
    it('returns the token once to an approved login request, and then expired', async () => {
      const { id: userId, context } = await member();
      const started = await start('laptop');
      await approve(context, started.userCode);

      const first = await poll(started.deviceSecret);
      const second = await poll(started.deviceSecret);

      if (first.status !== 'approved') throw new Error(`Expected approved, got ${first.status}`);
      expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
      const [runner] = await database.db
        .select()
        .from(runners)
        .where(eq(runners.id, first.runnerId));
      expect(runner).toMatchObject({ userId, name: 'laptop', platform: 'linux', status: 'active' });
      expect(runner?.tokenHash).toBe(hashSecret(first.token));
      expect(JSON.stringify(runner)).not.toContain(first.token);
      expect(second).toEqual({ status: 'expired' });
      expect(await loginOf(started.userCode)).toMatchObject({
        status: 'completed',
        runnerId: first.runnerId,
      });
    });

    it('returns pending, denied, and expired for an expired, unknown or completed one', async () => {
      const { context } = await member();
      const pending = await start();
      const denied = await start();
      await deny(context, denied.userCode);
      const expiredPending = await start();
      await expire(expiredPending.userCode);
      const expiredDenied = await start();
      await deny(context, expiredDenied.userCode);
      await expire(expiredDenied.userCode);

      expect(await poll(pending.deviceSecret)).toEqual({ status: 'pending' });
      expect(await poll(denied.deviceSecret)).toEqual({ status: 'denied' });
      expect(await poll(expiredPending.deviceSecret)).toEqual({ status: 'expired' });
      expect(await poll(expiredDenied.deviceSecret)).toEqual({ status: 'expired' });
      expect(await poll('A'.repeat(43))).toEqual({ status: 'expired' });
    });

    it('still completes a login request approved before its expiry and polled after it', async () => {
      const { context } = await member();
      const started = await start();
      await approve(context, started.userCode);
      await expire(started.userCode);

      expect(await poll(started.deviceSecret)).toMatchObject({ status: 'approved' });
    });

    it('completes an approved login request once under two concurrent polls', async () => {
      const { id: userId, context } = await member();
      const started = await start();
      await approve(context, started.userCode);

      const answers = await Promise.all([poll(started.deviceSecret), poll(started.deviceSecret)]);

      expect(answers.map((answer) => answer.status).toSorted()).toEqual(['approved', 'expired']);
      const owned = await database.db.select().from(runners).where(eq(runners.userId, userId));
      expect(owned).toHaveLength(1);
    });
  });

  describe('getLogin, approveLogin and denyLogin', () => {
    it('shows a pending login request, then the approver sets approved', async () => {
      const { id: userId, context } = await member();
      const started = await start('desk');

      const pending = await get(context, started.userCode);
      const approved = await approve(context, started.userCode);

      expect(pending).toMatchObject({ name: 'desk', platform: 'linux', status: 'pending' });
      expect(Date.parse(pending.requestedAt)).toBeLessThanOrEqual(Date.parse(pending.expiresAt));
      expect(approved.status).toBe('approved');
      expect(await loginOf(started.userCode)).toMatchObject({ status: 'approved', userId });
    });

    it('sets denied on deny', async () => {
      const { context } = await member();
      const started = await start();

      expect((await deny(context, started.userCode)).status).toBe('denied');
      expect((await get(context, started.userCode)).status).toBe('denied');
    });

    it('returns NOT_FOUND for an expired or unknown user code', async () => {
      const { context } = await member();
      const started = await start();
      await expire(started.userCode);

      for (const userCode of [started.userCode, 'ZZZZ-ZZZZ-ZZZZ']) {
        for (const act of [get, approve, deny]) {
          await expect(act(context, userCode)).rejects.toMatchObject({ code: 'NOT_FOUND' });
        }
      }
    });

    it('returns CONFLICT when approving or denying a decided or completed login request', async () => {
      const { context } = await member();
      const denied = await start();
      await deny(context, denied.userCode);
      const completed = await start();
      await approve(context, completed.userCode);
      await poll(completed.deviceSecret);

      for (const { userCode } of [denied, completed]) {
        await expect(approve(context, userCode)).rejects.toMatchObject({ code: 'CONFLICT' });
        await expect(deny(context, userCode)).rejects.toMatchObject({ code: 'CONFLICT' });
      }
    });

    it('finds the same login request by a user code without dashes or in lower case', async () => {
      const { context } = await member();
      const started = await start('typed');

      for (const userCode of [
        started.userCode.replaceAll('-', ''),
        started.userCode.toLowerCase(),
      ]) {
        expect(await get(context, userCode)).toMatchObject({ name: 'typed' });
      }
    });

    it('reports a completed login request as approved', async () => {
      const { context } = await member();
      const started = await start();
      await approve(context, started.userCode);
      await poll(started.deviceSecret);

      expect((await get(context, started.userCode)).status).toBe('approved');
    });
  });
});
