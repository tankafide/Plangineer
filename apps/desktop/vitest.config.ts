import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'desktop',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Stack tests need the Postgres binaries and the built bundles, so test:stack runs them.
    exclude: ['src/**/*.stack.test.ts'],
  },
});
