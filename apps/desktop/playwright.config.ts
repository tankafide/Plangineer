import { defineConfig } from '@playwright/test';

/**
 * The packaged-app journeys. They launch the AppImage `pnpm desktop:build` writes to `release/`,
 * which listens on the fixed ports 47100 and 47101, so the tests run one at a time.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  reporter: [['html', { open: 'never' }]],
  use: { trace: 'retain-on-failure' },
});
