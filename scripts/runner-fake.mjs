// Runs the paired runner with the fake agent, so pnpm dev has runs without a model.
import path from 'node:path';
import { execa } from 'execa';
import { reportFailure, repoRoot } from './script-entry.mjs';

const RUNNER_CLI = path.join(repoRoot, 'apps', 'runner', 'src', 'cli.ts');
const FAKE_AGENT = path.join(
  repoRoot,
  'apps',
  'runner',
  'src',
  'adapters',
  'claude-code',
  'fake-claude.ts',
);

try {
  await execa(process.execPath, [RUNNER_CLI, 'start'], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { PLANGINEER_CLAUDE_COMMAND: JSON.stringify([process.execPath, FAKE_AGENT]) },
  });
} catch (error) {
  reportFailure(error);
}
