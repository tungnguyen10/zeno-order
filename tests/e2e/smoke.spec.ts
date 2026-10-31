import { expect, test } from '@playwright/test'

test('landing page renders on mobile', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ZENO Order' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Đăng nhập chủ quán' })).toBeVisible()
})

test('health endpoint is reachable', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
