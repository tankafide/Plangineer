import { randomBytes } from 'node:crypto';
import { access, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import open from 'open';
import { setEnvValues } from './env-file.mjs';
import { checkCallback } from './github-app-callback.mjs';
import { readConversion } from './github-app-conversion.mjs';
import { buildManifest } from './github-app-manifest.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

const ENV_PATH = path.join(repoRoot, '.env');

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function manifestPage(manifest, state) {
  const action = `https://github.com/settings/apps/new?state=${state}`;
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Create the Plangineer dev app</title></head>
  <body>
    <form id="manifest" method="post" action="${escapeHtml(action)}">
      <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
      <noscript><button type="submit">Continue to GitHub</button></noscript>
    </form>
    <script>document.getElementById('manifest').submit();</script>
  </body>
</html>`;
}

function respond(response, status, body, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType });
  response.end(body);
}

async function convertManifest(code) {
  const response = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
  });
  return readConversion(response);
}

async function writeCredentials(app) {
  const text = await readFile(ENV_PATH, 'utf8');
  const values = {
    GITHUB_APP_ID: String(app.id),
    GITHUB_APP_CLIENT_ID: app.client_id,
    GITHUB_APP_CLIENT_SECRET: app.client_secret,
    GITHUB_APP_PRIVATE_KEY: app.pem,
  };
  await writeFile(ENV_PATH, setEnvValues(text, values));
}

/** Serves the manifest page, waits for GitHub's redirect and writes the app's credentials to .env. */
function runManifestFlow() {
  const state = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const server = createServer(async (request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') {
        const redirectUrl = `http://127.0.0.1:${server.address().port}/callback`;
        respond(
          response,
          200,
          manifestPage(buildManifest(redirectUrl), state),
          'text/html; charset=utf-8',
        );
        return;
      }
      if (url.pathname !== '/callback') {
        respond(response, 404, 'Not found');
        return;
      }
      const result = checkCallback(url.searchParams, state);
      server.close();
      if (!result.ok) {
        respond(response, result.status, result.message);
        reject(new Error(result.message));
        return;
      }
      try {
        const app = await convertManifest(result.code);
        await writeCredentials(app);
        respond(response, 200, 'Plangineer dev app created. You can close this tab.');
        resolve(app.html_url);
      } catch (error) {
        respond(response, 502, error.message);
        reject(error);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const pageUrl = `http://127.0.0.1:${server.address().port}/`;
      console.log(`Opening ${pageUrl}. Click "Create GitHub App" on GitHub.`);
      open(pageUrl).catch(reject);
    });
  });
}

async function main() {
  try {
    await access(ENV_PATH);
  } catch {
    console.error('Run pnpm setup:env first.');
    return 1;
  }
  try {
    const htmlUrl = await runManifestFlow();
    console.log(`Created ${htmlUrl}. Its credentials are in .env.`);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await main();
}
