import { defineConfig, devices } from '@playwright/test';

/**
 * Browser verification (PRD §92, §93, §101).
 * Covers a small Android phone, an iPhone-sized viewport, a tablet and a
 * laptop: the device classes the PRD names, not just a developer's desktop.
 */
export default defineConfig({
  testDir: './e2e',
  // Clears artifacts from an aborted run before starting a new one.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      // Use the Chromium already provisioned in this environment rather than
      // downloading a second copy at the version this Playwright pins.
      executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 800 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
