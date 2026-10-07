import { defineConfig } from '@playwright/test';

const host = '127.0.0.1';
const configuredPort = Number(process.env.SESSION_ISOLATION_TEST_PORT ?? '4180');
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4180;

export default defineConfig({
  testDir: '.',
  testMatch: 'session-isolation.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  globalSetup: './session-isolation-server.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  outputDir: '../../test-results/playwright-far017',
  reporter: 'line',
  use: {
    baseURL: `http://${host}:${port}`,
    browserName: 'chromium',
    actionTimeout: 5_000,
    navigationTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
