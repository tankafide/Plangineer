import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

function binPath(packageName, binName = packageName) {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  const { bin } = require(packageJsonPath);
  return path.resolve(path.dirname(packageJsonPath), typeof bin === 'string' ? bin : bin[binName]);
}

const steps = [
  { name: 'skills mirror check', args: ['scripts/sync-skills.mjs', '--check'] },
  { name: 'unit tests', args: [binPath('vitest'), 'run'] },
];

for (const { name, args } of steps) {
  console.log(`\n> ${name}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nverify failed at: ${name}`);
    process.exit(result.status ?? 1);
  }
}
