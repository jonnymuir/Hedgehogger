// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'line',
  // The fairness sweep plays each level 20 times end-to-end via a real
  // in-browser bot loop — comfortably longer than Playwright's 30s default.
  timeout: 120_000,
  use: {
    baseURL: 'http://127.0.0.1:8934',
    viewport: { width: 420, height: 800 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node server.js',
    url: 'http://127.0.0.1:8934/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
