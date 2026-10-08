import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** True when the module at moduleUrl is the script Node was started with. */
export function isEntryPoint(moduleUrl) {
  return (
    process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(moduleUrl)
  );
}
