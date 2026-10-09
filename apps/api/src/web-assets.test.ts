import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './test/test-app.ts';
import { createTestDatabase, type TestDatabase } from './test/test-database.ts';

const INDEX_HTML = '<!doctype html><title>Plangineer</title>';
const APP_JS = 'console.log("app");';

describe('web assets', () => {
  let database: TestDatabase;
  let webDistDir: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    webDistDir = await mkdtemp(path.join(os.tmpdir(), 'web-dist-'));
    await mkdir(path.join(webDistDir, 'assets'));
    await writeFile(path.join(webDistDir, 'index.html'), INDEX_HTML);
    await writeFile(path.join(webDistDir, 'assets', 'app.js'), APP_JS);
  });

  afterAll(async () => {
    await database.drop();
    await rm(webDistDir, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('with WEB_DIST_DIR set', () => {
    let testApp: Awaited<ReturnType<typeof createTestApp>>;

    beforeAll(async () => {
      testApp = await createTestApp(database, { WEB_DIST_DIR: webDistDir });
    });

    afterAll(() => testApp.close());

    it.each(['/', '/index.html', '/repositories', '/runs/123'])(
      'answers GET %s with index.html, checked on every load',
      async (url) => {
        const response = await testApp.app.request(url);

        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect(await response.text()).toBe(INDEX_HTML);
      },
    );

    it('serves a hashed asset with the immutable cache header', async () => {
      const response = await testApp.app.request('/assets/app.js');

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(await response.text()).toBe(APP_JS);
    });

    it('answers a missing asset with index.html, never with the immutable header', async () => {
      const response = await testApp.app.request('/assets/deleted.js');

      expect(response.headers.get('cache-control')).toBe('no-cache');
      expect(await response.text()).toBe(INDEX_HTML);
    });

    it.each(['/api/unknown', '/rpc/unknown'])(
      'answers %s with 404, never index.html',
      async (url) => {
        const response = await testApp.app.request(url);

        expect(response.status).toBe(404);
        expect(await response.text()).not.toContain(INDEX_HTML);
      },
    );
  });

  describe('with WEB_DIST_DIR unset', () => {
    let testApp: Awaited<ReturnType<typeof createTestApp>>;

    beforeAll(async () => {
      testApp = await createTestApp(database);
    });

    afterAll(() => testApp.close());

    it('answers GET / with 404', async () => {
      expect((await testApp.app.request('/')).status).toBe(404);
    });
  });
});
