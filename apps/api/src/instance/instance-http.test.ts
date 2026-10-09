import { generateKeyPairSync } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { githubApps } from '../db/schema.ts';
import { createLogger, type Logger } from '../logger.ts';
import { type FakeGithub, startFakeGithub } from '../test/fake-github.ts';
import { silentLogger, testEnv } from '../test/fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const { SETUP_TOKEN, BETTER_AUTH_URL: ORIGIN } = testEnv();
const CODE = 'manifest-code-1';

const CONVERSION = {
  id: 777,
  slug: 'plangineer-a1b2c3',
  clientId: 'Iv23new-client-id',
  clientSecret: 'new-client-secret-value',
  pem: generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  }).privateKey,
  ownerLogin: 'ada',
};

type App = Awaited<ReturnType<typeof createTestApp>>['app'];

function signIn(app: App) {
  return app.request('/api/auth/sign-in/social', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ provider: 'github' }),
  });
}

async function signInClientId(app: App): Promise<string | null> {
  const response = await signIn(app);
  const { url } = z.object({ url: z.url() }).parse(await response.json());
  return new URL(url).searchParams.get('client_id');
}

function postRpc(app: App, path: string, input: unknown) {
  return app.request(`/rpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': 'orpc' },
    body: JSON.stringify({ json: input }),
  });
}

/** GitHub App setup through the HTTP app, as the web client and a second process see it. */
describe('instance over HTTP', () => {
  let database: TestDatabase;
  let fake: FakeGithub;

  async function withApp(logger: Logger, work: (app: App) => Promise<void>) {
    const testApp = await createTestApp(database, {}, logger);
    try {
      await work(testApp.app);
    } finally {
      await testApp.close();
    }
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
    vi.restoreAllMocks();
    fake.reset();
  });

  afterAll(async () => {
    fake.close();
    await database.drop();
  });

  it('starts GitHub sign-in with the stored client ID after setup, with no restart', async () => {
    await withApp(silentLogger, async (app) => {
      expect((await signIn(app)).ok).toBe(false);

      const completed = await postRpc(app, 'instance/completeGithubApp', {
        setupToken: SETUP_TOKEN,
        code: CODE,
      });

      expect(completed.status).toBe(200);
      expect(await signInClientId(app)).toBe(CONVERSION.clientId);
    });
  });

  it('logs neither the setup token, the code, the client secret nor the key', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await withApp(createLogger('trace'), async (app) => {
      await postRpc(app, 'instance/githubAppManifest', { setupToken: SETUP_TOKEN });
      await postRpc(app, 'instance/completeGithubApp', { setupToken: SETUP_TOKEN, code: CODE });
      await postRpc(app, 'instance/completeGithubApp', { setupToken: SETUP_TOKEN, code: CODE });
    });

    const logs = output.join('');
    expect(logs).toContain('GitHub App created');
    for (const secret of [SETUP_TOKEN, CODE, CONVERSION.clientSecret, 'PRIVATE KEY']) {
      expect(logs).not.toContain(secret);
    }
  });

  it('uses an App another process inserted after the API started, with no restart', async () => {
    await withApp(silentLogger, async (app) => {
      expect((await signIn(app)).ok).toBe(false);

      // Another process: a second app with its own store over the same database.
      await withApp(silentLogger, async (other) => {
        await postRpc(other, 'instance/completeGithubApp', { setupToken: SETUP_TOKEN, code: CODE });
      });

      expect(await signInClientId(app)).toBe(CONVERSION.clientId);
    });
  });
});
