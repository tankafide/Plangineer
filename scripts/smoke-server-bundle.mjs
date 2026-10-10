import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';
import { reportFailure, repoRoot } from './script-entry.mjs';
import { envValues } from './setup-env.mjs';

const API_DIR = path.join(repoRoot, 'apps', 'api');
const READY_TIMEOUT_MS = 30_000;

/** The server folder as the desktop app ships it, from the built API and its assets. */
async function stageServer(serverDir) {
  await cp(path.join(API_DIR, 'dist'), path.join(serverDir, 'dist'), { recursive: true });
  await cp(path.join(API_DIR, 'drizzle'), path.join(serverDir, 'drizzle'), { recursive: true });
  for (const area of ['setup', 'features', 'planning']) {
    await cp(
      path.join(API_DIR, 'src', area, 'templates'),
      path.join(serverDir, 'src', area, 'templates'),
      { recursive: true },
    );
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(url, api) {
  let exit;
  void api.then((result) => (exit = result));
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exit !== undefined) throw new Error(`The API exited with code ${exit.exitCode}`);
    const response = await fetch(url).catch(() => undefined);
    if (response?.status === 200) return;
    await delay(250);
  }
  throw new Error(`${url} did not answer 200 within ${READY_TIMEOUT_MS} ms`);
}

/**
 * Migrates the database DATABASE_URL names with the migrate bundle, starts the API bundle from a
 * folder outside the repository with no node_modules, and waits for /api/auth/ok to answer 200.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl === undefined) throw new Error('Set DATABASE_URL to an empty database');
  const root = await mkdtemp(path.join(os.tmpdir(), 'plangineer-smoke-'));
  try {
    const serverDir = path.join(root, 'server');
    await stageServer(serverDir);
    const options = { cwd: root, extendEnv: false, stdio: 'inherit' };
    await execa(process.execPath, [path.join(serverDir, 'dist', 'migrate.mjs')], {
      ...options,
      env: { DATABASE_URL: databaseUrl },
    });

    const port = await freePort();
    const example = await readFile(path.join(repoRoot, '.env.example'), 'utf8');
    const env = {
      ...envValues(example),
      DATABASE_URL: databaseUrl,
      API_PORT: String(port),
      API_LOG_FILE: path.join(root, 'logs', 'api.log'),
    };
    const api = execa(process.execPath, [path.join(serverDir, 'dist', 'main.mjs')], {
      ...options,
      env,
      reject: false,
    });
    try {
      await waitForReady(`http://127.0.0.1:${port}/api/auth/ok`, api);
      console.log('The server bundle migrated the database and answered /api/auth/ok.');
    } finally {
      api.kill();
      await api;
    }
  } finally {
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  }
}

try {
  await main();
} catch (error) {
  reportFailure(error);
}
