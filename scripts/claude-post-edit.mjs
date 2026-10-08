// Claude Code PostToolUse hook: format-checks and lints the edited file. Exit 2 feeds the output back.
import { execa } from 'execa';
import { binPath } from './bin-path.mjs';
import { lintTargets, readHookInput } from './claude-hooks.mjs';
import { repoRoot } from './script-entry.mjs';

const input = await readHookInput();
const filePath = input.tool_input?.file_path;
if (typeof filePath !== 'string') {
  throw new Error(
    'PostToolUse hook input has no tool_input.file_path; the hook cannot check the edit',
  );
}
const target = lintTargets(filePath, repoRoot);

if (target !== undefined) {
  const checks = [
    [binPath('oxfmt'), '--check', '--no-error-on-unmatched-pattern', target.filePath],
  ];
  if (target.lint) {
    checks.push([binPath('oxlint'), '--type-aware', '--type-check', target.filePath]);
  }
  const results = await Promise.all(
    checks.map((args) =>
      execa(process.execPath, args, { cwd: repoRoot, reject: false, all: true }),
    ),
  );
  const failed = results.filter((result) => result.exitCode !== 0);
  if (failed.length > 0) {
    process.stderr.write(failed.map((result) => result.all).join('\n'));
    process.exitCode = 2;
  }
}
