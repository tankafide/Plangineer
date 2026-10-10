import { randomBytes } from 'node:crypto';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import { SimpleCsrfProtectionLinkPlugin } from '@orpc/client/plugins';
import type { RouterClient } from '@orpc/server';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { featureAttachments } from '../db/schema.ts';
import type { router } from '../rpc/router.ts';
import { sessionCookie, storeRunner, storeUser } from '../test/fixtures.ts';
import { storeRepository } from '../test/setup-fixtures.ts';
import { createTestApp } from '../test/test-app.ts';
import { createTestDatabase, type TestDatabase } from '../test/test-database.ts';

const MiB = 1024 * 1024;

/** feature.create over HTTP, as the web client sends it: attachments as multipart files. */
describe('feature.create over HTTP', () => {
  let database: TestDatabase;
  let testApp: Awaited<ReturnType<typeof createTestApp>>;
  let cookie: string;
  let repositoryId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    testApp = await createTestApp(database);
    const user = await storeUser(testApp.auth);
    cookie = await sessionCookie(testApp.auth, user.id);
    await storeRunner(database.db, { userId: user.id });
    repositoryId = await storeRepository(database.db, { createdBy: user.id });
  });

  afterAll(async () => {
    await testApp.close();
    await database.drop();
  });

  const client = (): RouterClient<typeof router> =>
    createORPCClient(
      new RPCLink({
        url: 'http://localhost/rpc',
        headers: { cookie },
        fetch: async (request) => testApp.app.fetch(request),
        plugins: [new SimpleCsrfProtectionLinkPlugin()],
      }),
    );

  it('stores a 3 MiB attachment sent through RPCLink byte for byte', async () => {
    const bytes = randomBytes(3 * MiB);

    const detail = await client().feature.create({
      description: 'Match the attached design.',
      attachments: [new File([bytes], 'design.pdf', { type: 'application/pdf' })],
      exploreCodebase: false,
      researchTopics: [],
      runMode: 'manual',
      repositoryIds: [repositoryId],
    });

    const [stored] = await database.db
      .select({
        name: featureAttachments.name,
        mediaType: featureAttachments.mediaType,
        content: featureAttachments.content,
      })
      .from(featureAttachments)
      .where(eq(featureAttachments.featureId, detail.id));
    expect(stored?.name).toBe('design.pdf');
    expect(stored?.mediaType).toBe('application/pdf');
    expect(stored?.content.equals(bytes)).toBe(true);
  });

  const post = (path: string, bytes: number) =>
    testApp.app.request(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(bytes),
        'x-csrf-token': 'orpc',
        cookie,
      },
      body: new Uint8Array(bytes),
    });

  it('answers 413 to a 27 MiB feature.create body', async () => {
    const response = await post('/rpc/feature/create', 27 * MiB);

    expect(response.status).toBe(413);
  });

  it('keeps the 1 MiB limit on every other procedure', async () => {
    const response = await post('/rpc/feature/list', 2 * MiB);

    expect(response.status).toBe(413);
  });
});
