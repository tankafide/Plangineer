import { defineConfig } from 'vitest/config';
import { removeGitLocalEnv } from './scripts/git-env.mjs';

// Test workers inherit this environment, and pnpm verify runs inside the pre-push hook.
removeGitLocalEnv(process.env);

export default defineConfig({
  test: {
    // Every API test file clones a Postgres database. Four workers bound the load on that one
    // Postgres and on the machine, and match the most cores a CI runner has.
    maxWorkers: 4,
    projects: [
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } },
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
    ],
  },
});
