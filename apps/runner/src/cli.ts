import { readFileSync } from 'node:fs';

const USAGE = 'Usage: plangineer-runner --version';

function packageVersion(): string {
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

const args = process.argv.slice(2);

if (args.length === 1 && args[0] === '--version') {
  console.log(packageVersion());
} else {
  console.error(USAGE);
  process.exitCode = 1;
}
