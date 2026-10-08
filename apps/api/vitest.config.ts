import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'api',
    environment: 'node',
    globalSetup: ['src/test/global-setup.ts'],
  },
});
