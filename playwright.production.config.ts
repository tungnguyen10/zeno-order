import { defineConfig } from '@playwright/test'
import base from './playwright.config'

export default defineConfig({
  ...base,
  workers: 1,
  retries: 0,
  use: { ...base.use, baseURL: 'http://127.0.0.1:3200' },
  webServer: {
    command: 'node .output/server/index.mjs', url: 'http://127.0.0.1:3200/api/health', reuseExistingServer: false, timeout: 120_000,
    env: { NODE_ENV: 'production', NITRO_HOST: '127.0.0.1', NITRO_PORT: '3200', AUTH_TEST_JWKS: '' },
  },
})
