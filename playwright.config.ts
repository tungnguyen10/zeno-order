import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      NUXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NUXT_PUBLIC_TURNSTILE_SITE_KEY ?? '1x00000000000000000000AA',
      NUXT_TURNSTILE_SECRET_KEY: process.env.NUXT_TURNSTILE_SECRET_KEY ?? '1x0000000000000000000000000000000AA',
      NUXT_ORDER_RATE_LIMIT_MAX: process.env.NUXT_ORDER_RATE_LIMIT_MAX ?? '1000',
      NUXT_TRACKING_KEY_VERSION: process.env.NUXT_TRACKING_KEY_VERSION ?? '1',
      NUXT_TRACKING_SECRETS_JSON: process.env.NUXT_TRACKING_SECRETS_JSON
        ?? '{"1":"local-playwright-tracking-secret-32-bytes-minimum"}',
    },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
