import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'desktop-stack',
    environment: 'node',
    include: ['src/**/*.stack.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
