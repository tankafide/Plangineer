import { execa } from 'execa';
import { isEntryPoint, reportFailure, repoRoot } from './script-entry.mjs';

/** Starts the Compose Postgres service and resolves once its healthcheck passes. */
export async function startPostgres() {
  try {
    await execa('docker', ['info'], { stdio: 'ignore' });
  } catch (error) {
    throw new Error('Docker is not running. Start Docker Desktop, then rerun pnpm db:up.', {
      cause: error,
    });
  }
  await execa('docker', ['compose', 'up', '--wait', 'postgres'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}

if (isEntryPoint(import.meta.url)) {
  try {
    await startPostgres();
  } catch (error) {
    reportFailure(error);
  }
}
