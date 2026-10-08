import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'runner',
    environment: 'node',
    // Runner tests run git and the fake agent as real child processes.
    testTimeout: 30_000,
  },
});
