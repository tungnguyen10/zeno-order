import { defineConfig } from '@playwright/test'
import base from './playwright.config'
import { browserBaseUrl, browserServerEnv, browserTls } from './tests/support/browser-production'

export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: process.env.PLAYWRIGHT_HTML_OUTPUT_DIR ?? 'playwright-report', open: 'never' }]],
  use: { ...base.use, baseURL: browserBaseUrl, ignoreHTTPSErrors: browserTls },
  webServer: {
    command: 'node .output/server/index.mjs', url: `${browserBaseUrl}/api/health`, ignoreHTTPSErrors: browserTls, reuseExistingServer: false, timeout: 120_000,
    env: browserServerEnv,
  },
})
