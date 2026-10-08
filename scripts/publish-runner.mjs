import path from 'node:path';
import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { isEntryPoint, repoRoot } from './script-entry.mjs';

/**
 * Publishes apps/runner to npm as plangineer-runner: refuses a dirty working tree, builds, runs
 * the runner's tests, then runs npm publish. The engineer runs it, since publishing is visible
 * outside the machine.
 */
export async function publishRunner(rootDir) {
  const status = await execa('git', ['status', '--porcelain'], { cwd: rootDir });
  if (status.stdout.trim() !== '') {
    console.error('The working tree has uncommitted changes. Commit or stash them, then publish.');
    return 1;
  }
  const runnerDir = path.join(rootDir, 'apps', 'runner');
  const steps = [
    { name: 'build', file: 'pnpm', args: ['--filter', 'plangineer-runner', 'build'], cwd: rootDir },
    {
      name: 'tests',
      file: process.execPath,
      args: [binPath('vitest'), 'run', '--project', 'runner'],
      cwd: rootDir,
    },
    { name: 'npm publish', file: 'npm', args: ['publish', '--access', 'public'], cwd: runnerDir },
  ];
  for (const { name, file, args, cwd } of steps) {
    console.log(`\n> ${name}`);
    const result = await execa(file, args, { cwd, stdio: 'inherit', reject: false });
    if (result.exitCode !== 0) {
      console.error(`\nPublishing stopped at: ${name}`);
      return 1;
    }
  }
  return 0;
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await publishRunner(repoRoot);
}
