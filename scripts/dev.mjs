import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { startPostgres } from './db-up.mjs';
import { reportFailure, repoRoot } from './script-entry.mjs';

const options = { cwd: repoRoot, stdio: 'inherit' };
const POLL_MS = 500;

/** Waits for the API to answer, then prints the link that sets up the GitHub App. */
async function printSetupLink(env, dev) {
  const turbo = { ended: false };
  void dev.finally(() => (turbo.ended = true)).catch(() => {});
  const okUrl = `http://localhost:${env.API_PORT}/api/auth/ok`;
  while (!turbo.ended) {
    const response = await fetch(okUrl).catch(() => undefined);
    if (response?.status === 200) {
      console.log(
        `\nSet up Plangineer at http://localhost:5173/get-started#setup-token=${env.SETUP_TOKEN}\n`,
      );
      return;
    }
    await delay(POLL_MS);
  }
}

try {
  const env = parseEnv(await readFile(path.join(repoRoot, '.env'), 'utf8'));
  await startPostgres();
  await execa('pnpm', ['--filter', '@plangineer/api', 'db:migrate'], options);
  await execa('pnpm', ['--filter', '@plangineer/api', 'db:seed'], options);
  const dev = execa(
    process.execPath,
    [binPath('turbo'), 'run', 'dev', '--filter=@plangineer/api', '--filter=@plangineer/web'],
    options,
  );
  await printSetupLink(env, dev);
  await dev;
} catch (error) {
  reportFailure(error);
}
