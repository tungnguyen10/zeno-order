import { assertTestDatabase, loadEnvFileOverride } from './tests/support/test-env'
import { defineConfig, devices } from '@playwright/test'
import { browserBaseUrl, browserServerEnv, browserTls } from './tests/support/browser-production'

loadEnvFileOverride('.env.test')
assertTestDatabase()
export default defineConfig({
  testDir: 'tests/e2e-hardening',
  tsconfig: 'tests/e2e/tsconfig.json',
  workers: 1, fullyParallel: false, timeout: 60_000,
  expect: { timeout: 15_000 }, retries: 0,
  reporter: [['list'], ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report', open: 'never' }]],
  use: { baseURL: browserBaseUrl, ignoreHTTPSErrors: browserTls, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node .output/server/index.mjs', url: `${browserBaseUrl}/api/health`, ignoreHTTPSErrors: browserTls, reuseExistingServer: false, timeout: 120_000,
    env: browserServerEnv,
  },
})
