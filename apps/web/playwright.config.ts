import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { readFileSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
import { readApiPort } from './api-port.ts';

const envFile = fileURLToPath(new URL('../../.env', import.meta.url));
const apiPort = readApiPort(parseEnv(readFileSync(envFile, 'utf8')));
const WEB_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: 'e2e',
  reporter: [['html', { open: 'never' }]],
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'desktop-chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @plangineer/api start',
      url: `http://localhost:${apiPort}/api/auth/ok`,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @plangineer/web dev',
      url: WEB_URL,
      reuseExistingServer: false,
    },
  ],
});
