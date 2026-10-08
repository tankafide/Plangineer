import { spawnSync } from 'node:child_process';
import { binPath } from './bin-path.mjs';

const steps = [
  { name: 'format check', args: [binPath('oxfmt'), '--check'] },
  { name: 'skills mirror check', args: ['scripts/sync-skills.mjs', '--check'] },
  { name: 'Oxlint', args: [binPath('oxlint'), '--type-aware', '--type-check'] },
  { name: 'typecheck', args: [binPath('turbo'), 'run', 'typecheck'] },
  {
    name: 'dependency-cruiser',
    args: [
      binPath('dependency-cruiser'),
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'err-long',
      'apps',
      'packages',
    ],
  },
  { name: 'Knip', args: [binPath('knip')] },
  { name: 'Vitest', args: [binPath('vitest'), 'run'] },
];

for (const { name, args } of steps) {
  console.log(`\n> ${name}`);
  const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nverify failed at: ${name}`);
    process.exit(result.status ?? 1);
  }
}
