import { execa } from 'execa';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

/** Starts the Compose Postgres service and resolves once its healthcheck passes. */
export async function startPostgres() {
  try {
    await execa('docker', ['info'], { stdio: 'ignore' });
  } catch {
    throw new Error('Docker is not running. Start Docker Desktop, then rerun pnpm db:up.');
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
    console.error(error.message);
    process.exitCode = 1;
  }
}
