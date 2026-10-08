import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { findBusyPorts } from './ports.mjs';
import { reportFailure, repoRoot } from './script-entry.mjs';

const WEB_DIR = path.join(repoRoot, 'apps', 'web');
const WEB_PORT = 5173;

async function main() {
  const env = parseEnv(await readFile(path.join(repoRoot, '.env'), 'utf8'));
  // The same rule as the API's environment schema: digits only, from 1 to 65535.
  const apiPort = /^\d+$/.test(env.API_PORT ?? '') ? Number(env.API_PORT) : Number.NaN;
  if (!(apiPort >= 1 && apiPort <= 65535)) {
    throw new Error(`API_PORT in .env is missing or not a port number: ${env.API_PORT}`);
  }
  const busy = await findBusyPorts([WEB_PORT, apiPort]);
  if (busy.length > 0) {
    console.error(
      `Ports ${busy.join(', ')} are in use. Stop pnpm dev before running pnpm test:e2e.`,
    );
    return 1;
  }
  const options = { cwd: repoRoot, stdio: 'inherit' };
  await execa('pnpm', ['db:reset'], options);
  const playwright = binPath(
    '@playwright/test',
    'playwright',
    pathToFileURL(path.join(WEB_DIR, 'package.json')).href,
  );
  await execa(
    process.execPath,
    [playwright, 'test', '--config', path.join(WEB_DIR, 'playwright.config.ts')],
    options,
  );
  return 0;
}

try {
  process.exitCode = await main();
} catch (error) {
  reportFailure(error);
}
