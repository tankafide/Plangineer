import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import path from 'node:path';

/** Resolves an installed CLI's JavaScript bin, so it can be spawned with process.execPath. */
export function binPath(packageName, binName = packageName, base = import.meta.url) {
  const packageJsonPath = findPackageJSON(packageName, base);
  if (packageJsonPath === undefined) throw new Error(`${packageName} is not installed`);
  const { bin } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  const relative = typeof bin === 'string' ? bin : bin?.[binName];
  if (relative === undefined) throw new Error(`${packageName} has no bin named ${binName}`);
  return path.resolve(path.dirname(packageJsonPath), relative);
}
