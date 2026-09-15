import { expect, test } from '@playwright/test'

test('renders the seeded storefront on mobile Chromium', async ({ page }) => {
  const response = await page.goto('/s/mochi-cafe')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mochi Cafe')
  await expect(page.getByText('Thực đơn sắp được cập nhật')).toBeVisible()
  expect(await page.content()).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i)
})

test('returns the same public 404 for an unknown store', async ({ page }) => {
  const response = await page.goto('/s/cua-hang-khong-ton-tai')

  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy cửa hàng.')
})

test('public API exposes only the safe storefront contract', async ({ request }) => {
  const response = await request.get('/api/storefront/mochi-cafe')
  const body = await response.json()

  expect(response.status()).toBe(200)
  expect(body).toEqual({
    publicSlug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: 'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
    logoPath: null,
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  })
  expect(JSON.stringify(body)).not.toMatch(/[0-9a-f]{8}-[0-9a-f-]{27}/i)
})

test('public API returns the stable not-found error contract', async ({ request }) => {
  const response = await request.get('/api/storefront/cua-hang-khong-ton-tai')

  expect(response.status()).toBe(404)
  await expect(response.json()).resolves.toEqual({
    error: {
      code: 'STORE_NOT_FOUND',
      message: 'Không tìm thấy cửa hàng.',
    },
  })
})
