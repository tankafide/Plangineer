import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { Auth } from './auth/auth.ts';
import { createApp } from './app.ts';
import { user } from './db/schema.ts';
import {
  GITHUB_CLIENT_ID,
  sessionCookie,
  silentLogger,
  storeUser,
  testAuth,
  testEnv,
} from './test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from './test/test-database.ts';

const ORIGIN = testEnv().BETTER_AUTH_URL;
const CSRF_HEADER = { 'x-csrf-token': 'orpc' };

describe('createApp', () => {
  let database: TestDatabase;
  let auth: Auth;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    database = await createTestDatabase();
    auth = testAuth(database.db);
    app = createApp({ auth, logger: silentLogger });
  });

  afterAll(async () => {
    await database.drop();
  });

  function callMe(headers: Record<string, string>, body = '{}') {
    return app.request('/rpc/me/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    });
  }

  describe('Better Auth routes', () => {
    it('answers GET /api/auth/ok with 200', async () => {
      const response = await app.request('/api/auth/ok');

      expect(response.status).toBe(200);
    });

    it('starts GitHub sign-in with the configured client id', async () => {
      const response = await app.request('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ provider: 'github' }),
      });

      expect(response.status).toBe(200);
      const { url } = z.object({ url: z.url() }).parse(await response.json());
      const authorize = new URL(url);
      expect(`${authorize.origin}${authorize.pathname}`).toBe(
        'https://github.com/login/oauth/authorize',
      );
      expect(authorize.searchParams.get('client_id')).toBe(GITHUB_CLIENT_ID);
    });

    it('rejects a role the client sends to update-user, leaving it member', async () => {
      const stored = await storeUser(auth);

      const response = await app.request('/api/auth/update-user', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          cookie: await sessionCookie(auth, stored.id),
        },
        body: JSON.stringify({ role: 'admin' }),
      });

      // Better Auth checks the session and origin first, so this code proves the role guard ran.
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'FIELD_NOT_ALLOWED' });
      const [row] = await database.db
        .select({ role: user.role })
        .from(user)
        .where(eq(user.id, stored.id));
      expect(row).toEqual({ role: 'member' });
    });
  });

  describe('RPC routes', () => {
    it('returns the signed-in user for the session cookie', async () => {
      const stored = await storeUser(auth, { name: 'Grace Hopper' });

      const response = await callMe({
        ...CSRF_HEADER,
        cookie: await sessionCookie(auth, stored.id),
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        json: { id: stored.id, name: 'Grace Hopper', email: stored.email, role: 'member' },
      });
    });

    it('answers 401 without a session cookie', async () => {
      const response = await callMe(CSRF_HEADER);

      expect(response.status).toBe(401);
    });

    it('rejects a call without the CSRF header', async () => {
      const stored = await storeUser(auth);

      const response = await callMe({ cookie: await sessionCookie(auth, stored.id) });

      expect(response.status).toBe(403);
    });

    it('answers 413 to a body over 1 MiB', async () => {
      const body = JSON.stringify({ json: 'x'.repeat(1024 * 1024) });

      const response = await callMe(CSRF_HEADER, body);

      expect(response.status).toBe(413);
    });
  });
});
