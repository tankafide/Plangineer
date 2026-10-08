// Claude Code Stop hook: runs pnpm verify when the turn changed code. Exit 2 makes the agent fix it.
import path from 'node:path';
import { execa } from 'execa';
import { parseStatusPaths, readHookInput, shouldRunVerify } from './claude-hooks.mjs';
import { repoRoot } from './script-entry.mjs';

const TAIL_LINES = 40;

const input = await readHookInput();
const status = await execa('git', ['status', '--porcelain', '-z'], { cwd: repoRoot });
const changedPaths = parseStatusPaths(status.stdout);

if (shouldRunVerify({ stopHookActive: input.stop_hook_active === true, changedPaths })) {
  const verify = await execa(process.execPath, [path.join(repoRoot, 'scripts', 'verify.mjs')], {
    cwd: repoRoot,
    reject: false,
    all: true,
  });
  if (verify.exitCode !== 0) {
    const lines = verify.all.split(/\r?\n/);
    const failedStep =
      lines.find((line) => line.startsWith('verify failed at:')) ?? 'verify failed';
    process.stderr.write(`${failedStep}\n\n${lines.slice(-TAIL_LINES).join('\n')}\n`);
    process.exitCode = 2;
  }
}
