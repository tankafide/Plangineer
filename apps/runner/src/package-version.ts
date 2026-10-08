import { readFileSync } from 'node:fs';

/** The runner's version from its package.json. */
export function packageVersion(): string {
  const manifest: unknown = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new Error('apps/runner/package.json has no version string');
  }
  return manifest.version;
}
