import { defineConfig, devices } from '@playwright/test';

/**
 * Post-deployment smoke tests against a live Convo deployment (default https://convo.doncik.ro).
 * They create no devices or messages; the only state they leave is passkeys on the dedicated smoke
 * account (SMOKE_USERNAME / SMOKE_PASSWORD), which the runner removes before each run.
 *
 *   BASE_URL=https://convo.doncik.ro SMOKE_USERNAME=… SMOKE_PASSWORD=… \
 *     npx playwright test -c smoke/playwright.smoke.config.ts
 */
export default defineConfig({
  testDir: '.',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results/smoke',
  use: { baseURL: process.env.BASE_URL ?? 'https://convo.doncik.ro', trace: 'retain-on-failure', ...devices['Desktop Chrome'] },
});
