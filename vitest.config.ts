import { defineConfig } from 'vitest/config';
import { removeGitLocalEnv } from './scripts/git-env.mjs';

// Test workers inherit this environment, and pnpm verify runs inside the pre-push hook.
removeGitLocalEnv(process.env);

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'scripts', include: ['scripts/**/*.test.mjs'] } },
      'packages/*/vitest.config.ts',
      'apps/*/vitest.config.ts',
    ],
  },
});
