import { defineConfig } from '@playwright/test';
import base from '../playwright.config';

/**
 * Web ↔ Android interoperability tests. They need an emulator driven by `run-call.sh`, so they
 * live outside the default `testDir`; browser settings (fake media devices) come from the main config.
 */
export default defineConfig({
  ...base,
  testDir: '.',
  retries: 0,
  reporter: [['list']],
  outputDir: '../test-results/android',
  projects: base.projects?.filter((p) => p.name === 'chromium'),
});
