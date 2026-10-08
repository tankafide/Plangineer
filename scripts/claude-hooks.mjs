import path from 'node:path';

const LINT_EXTENSIONS = ['.ts', '.tsx', '.mjs', '.cjs'];
// Oxfmt formats JSON, but Oxlint does not lint it and exits 1 on a JSON-only target.
const FORMAT_ONLY_EXTENSIONS = ['.json'];

const hasExtension = (filePath, extensions) =>
  extensions.some((extension) => filePath.endsWith(extension));

/**
 * The checks the PostToolUse hook runs on an edited file, or undefined when it checks nothing:
 * a file outside the repository, or one with no matching extension.
 */
export function lintTargets(filePath, repoRoot) {
  const relative = path.relative(repoRoot, path.resolve(repoRoot, filePath));
  const outside =
    relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (outside) return undefined;
  if (hasExtension(filePath, LINT_EXTENSIONS)) return { filePath, lint: true };
  if (hasExtension(filePath, FORMAT_ONLY_EXTENSIONS)) return { filePath, lint: false };
  return undefined;
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
