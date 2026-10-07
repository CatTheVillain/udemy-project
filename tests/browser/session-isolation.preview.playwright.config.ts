import { defineConfig } from '@playwright/test';

import defaultConfig from './session-isolation.playwright.config';

export default defineConfig({
  ...defaultConfig,
  globalSetup: './session-isolation-preview-server.ts',
});
