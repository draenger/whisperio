import { defineConfig } from '@playwright/test'

// Click-test harness for the Electron app (P0.1). Separate from vitest
// entirely — these specs launch the real, built app (out/main/index.js) via
// Playwright's Electron driver and click through actual windows. See
// e2e/helpers.ts for the launch/teardown plumbing and WHISPERIO_USER_DATA_DIR
// isolation, and package.json's `test:e2e` script (`npm run build` first).
export default defineConfig({
  testDir: 'e2e',
  // One Electron app instance at a time — each spec gets its own temp
  // userData dir (isolated), but running several real Electron processes
  // concurrently on a CI runner (esp. under xvfb on Linux) is a flakiness
  // magnet for no real speed win at this test count.
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  reporter: process.env['CI']
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']]
})
