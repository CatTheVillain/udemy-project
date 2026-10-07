import { defineConfig } from '@playwright/test';

import defaultConfig from './instructor-course-editor-fe014.playwright.config';

const viteControlTitles =
  /(?:rejects an ERR_ABORTED diagnostic through the fail-closed monitor control|accounts for exact expected-negative HTTP console diagnostics through the local monitor|proves real Vite-graph Dialog and Select touch cancellation, scroll, and focus boundaries)$/u;

export default defineConfig({
  ...defaultConfig,
  grep: viteControlTitles,
});
