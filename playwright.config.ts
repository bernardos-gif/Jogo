import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 15 * 60 * 1000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
});
