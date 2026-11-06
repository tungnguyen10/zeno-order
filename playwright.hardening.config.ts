import { assertTestDatabase, loadEnvFileOverride } from './tests/support/test-env'
import { defineConfig, devices } from '@playwright/test'

loadEnvFileOverride('.env.test')
assertTestDatabase()
export default defineConfig({
  testDir: 'tests/e2e-hardening',
  tsconfig: 'tests/e2e/tsconfig.json',
  workers: 1, fullyParallel: false, timeout: 60_000,
  expect: { timeout: 15_000 }, retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL: 'http://localhost:3100', locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
    { name: 'desktop-chrome', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node .output/server/index.mjs', url: 'http://127.0.0.1:3100/api/health', reuseExistingServer: false, timeout: 120_000,
    env: { NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3100', AUTH_TEST_JWKS: '' },
  },
})
