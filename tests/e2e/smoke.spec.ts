import { expect, test } from '@playwright/test'

test('landing page renders on mobile', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Đặt món tại bàn, không cần app' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Đăng nhập chủ quán' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Tạo quán miễn phí' }).first()).toHaveAttribute('href', '/signup')
  await expect(page).toHaveTitle(/ZENO Order/)
})

test('health endpoint is reachable', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ status: 'ok' })
})
