import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { call, ORPCError } from '@orpc/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { githubApps } from '../db/schema.ts';
import type { InitialContext } from '../rpc/context.ts';
import { router } from '../rpc/router.ts';
import { fakeRepository } from '../test/fake-github-state.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { testDeps, testEnv } from '../test/fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const SETUP_TOKEN = testEnv().SETUP_TOKEN;
const WRONG_TOKEN = 'w'.repeat(43);
const CODE = 'manifest-code-1';
const ORIGIN = testEnv().BETTER_AUTH_URL;

/** A new App's key as GitHub issues it, in PKCS#1 form. */
function pkcs1Key() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey;
}

const CONVERSION = {
  id: 777,
  slug: 'plangineer-a1b2c3',
  clientId: 'Iv23new-client-id',
  clientSecret: 'new-client-secret-value',
  pem: pkcs1Key(),
  ownerLogin: 'ada',
};

const Manifest = z.object({
  redirect_url: z.string(),
  callback_urls: z.array(z.string()),
  setup_url: z.string(),
});

describe('instance', () => {
  let database: TestDatabase;
  let fake: FakeGithub;

  /** A fresh context per call, so no store caches across the test's own writes. */
  const context = (): InitialContext => ({ ...testDeps(database.db), session: null });

  async function storedRows() {
    return database.db
      .select({
        appId: githubApps.appId,
        clientId: githubApps.clientId,
        clientSecretEncrypted: githubApps.clientSecretEncrypted,
        privateKeyEncrypted: githubApps.privateKeyEncrypted,
      })
      .from(githubApps);
  }

  function complete(setupToken = SETUP_TOKEN, code = CODE) {
    return call(router.instance.completeGithubApp, { setupToken, code }, { context: context() });
  }

  beforeAll(async () => {
    fake = startFakeGithub();
    database = await createTestDatabase();
  });

  beforeEach(async () => {
    await database.db.delete(githubApps);
    fake.manifestConversions.set(CODE, CONVERSION);
  });

  afterEach(() => {
    fake.reset();
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  describe('getStatus', () => {
    it('answers missing with no App, with no session', async () => {
      await expect(
        call(router.instance.getStatus, undefined, { context: context() }),
      ).resolves.toEqual({ githubApp: 'missing', githubAppSlug: null });
    });

    it('answers configured with the slug once an App exists', async () => {
      await complete();

      await expect(
        call(router.instance.getStatus, undefined, { context: context() }),
      ).resolves.toEqual({ githubApp: 'configured', githubAppSlug: CONVERSION.slug });
    });
  });

  describe('githubAppManifest', () => {
    it('returns a manifest whose URLs start with BETTER_AUTH_URL, to post to GitHub', async () => {
      const output = await call(
        router.instance.githubAppManifest,
        { setupToken: SETUP_TOKEN },
        { context: context() },
      );

      const manifest = Manifest.parse(JSON.parse(output.manifest));
      expect(output.postUrl).toBe('https://github.com/settings/apps/new');
      expect(manifest.redirect_url).toBe(`${ORIGIN}/get-started`);
      expect(manifest.callback_urls).toEqual([`${ORIGIN}/api/auth/callback/github`]);
      expect(manifest.setup_url).toBe(`${ORIGIN}/repositories`);
    });

    it('answers UNAUTHORIZED for a wrong token', async () => {
      await expect(
        call(
          router.instance.githubAppManifest,
          { setupToken: WRONG_TOKEN },
          { context: context() },
        ),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('answers CONFLICT once an App exists', async () => {
      await complete();

      await expect(
        call(
          router.instance.githubAppManifest,
          { setupToken: SETUP_TOKEN },
          { context: context() },
        ),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('completeGithubApp', () => {
    it('stores one App with the client secret and a PKCS#8 key encrypted, and answers configured', async () => {
      const status = await complete();

      expect(status).toEqual({ githubApp: 'configured', githubAppSlug: CONVERSION.slug });
      const rows = await storedRows();
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row).toMatchObject({ appId: CONVERSION.id, clientId: CONVERSION.clientId });
      expect(row?.clientSecretEncrypted).not.toContain(CONVERSION.clientSecret);
      expect(row?.privateKeyEncrypted).not.toContain('PRIVATE KEY');
      const stored = await context().appStore.get();
      expect(stored?.clientSecret).toBe(CONVERSION.clientSecret);
      expect(stored?.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    });

    it.each([
      ['a wrong token', () => complete(WRONG_TOKEN), 'UNAUTHORIZED'],
      ['a code GitHub does not know', () => complete(SETUP_TOKEN, 'unknown-code'), 'GITHUB_FAILED'],
    ])('stores nothing for %s', async (_, attempt, code) => {
      await expect(attempt()).rejects.toMatchObject({ code });
      expect(await storedRows()).toEqual([]);
    });

    it('answers GITHUB_FAILED with GitHub status for a 404', async () => {
      const error = await complete(SETUP_TOKEN, 'unknown-code').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ORPCError);
      expect(error).toMatchObject({ code: 'GITHUB_FAILED', data: { status: 404 } });
    });

    it('answers CONFLICT when an App exists, keeping the stored one', async () => {
      await complete();
      fake.manifestConversions.set('second-code', { ...CONVERSION, id: 888 });

      await expect(complete(SETUP_TOKEN, 'second-code')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
      expect((await storedRows()).map((row) => row.appId)).toEqual([CONVERSION.id]);
    });

    it('signs installation token requests with the stored App ID and key', async () => {
      const deps = { ...testDeps(database.db), session: null };
      await call(
        router.instance.completeGithubApp,
        { setupToken: SETUP_TOKEN, code: CODE },
        {
          context: deps,
        },
      );
      fake.repositories.push(fakeRepository());

      await deps.github.getRepository(1, 1001);

      const [request] = fake.tokenRequests;
      const [header, payload, signature] = (request?.appJwt ?? '').split('.');
      const claims = z
        .object({ iss: z.union([z.number(), z.string()]) })
        .parse(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString()));
      expect(String(claims.iss)).toBe(String(CONVERSION.id));
      expect(
        verify(
          'RSA-SHA256',
          Buffer.from(`${header}.${payload}`),
          createPublicKey(CONVERSION.pem),
          Buffer.from(signature ?? '', 'base64url'),
        ),
      ).toBe(true);
    });
  });
});
