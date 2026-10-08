const LINT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs', '.json'];

/** The edited file when the PostToolUse hook should format-check and lint it, otherwise undefined. */
export function lintTargets(filePath) {
  return LINT_EXTENSIONS.some((extension) => filePath.endsWith(extension)) ? filePath : undefined;
}

/** Whether the Stop hook should run pnpm verify for the turn's changed paths. */
export function shouldRunVerify({ stopHookActive, changedPaths }) {
  if (stopHookActive) return false;
  return !changedPaths.every((changed) => changed.startsWith('docs/'));
}

/** The paths in `git status --porcelain -z` output, including both sides of a rename. */
export function parseStatusPaths(output) {
  const entries = output.split('\0').filter((entry) => entry !== '');
  const paths = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    paths.push(entry.slice(3));
    // A rename or copy is followed by its original path as a separate entry.
    if (/^[RC]/.test(entry)) {
      index += 1;
      paths.push(entries[index]);
    }
  }
  return paths;
}

/** Reads a hook's JSON input from stdin. */
export async function readHookInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}
