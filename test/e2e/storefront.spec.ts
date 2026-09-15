import { expect, test } from '@playwright/test'

const catalogCachePolicy = 'public, max-age=0, s-maxage=120, stale-while-revalidate=60'
const storeId = '20000000-0000-0000-0000-000000000001'
const organizationId = '10000000-0000-0000-0000-000000000001'

test('renders the seeded catalog in deterministic order on mobile Chromium', async ({ page }) => {
  const response = await page.goto('/s/mochi-cafe')

  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Mochi Cafe')
  await expect(page.getByRole('navigation', { name: 'Danh mục thực đơn' })).toBeVisible()
  await expect(page.locator('[data-storefront-section]')).toHaveCount(3)
  await expect(page.locator('[data-storefront-section] h2')).toHaveText([
    'Cà phê',
    'Trà trái cây',
    'Bánh ngọt',
  ])
  await expect(page.locator('[data-product-card] h3')).toHaveText([
    'Cà phê sữa đá',
    'Trà đào cam sả',
    'Matcha latte',
    'Mochi dâu',
  ])
  await expect(page.locator('[data-product-card]').filter({ hasText: 'Mochi dâu' }).getByText('Tạm hết món')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Cà phê' })).toHaveAttribute('href', '#ca-phe')

  const html = await page.content()
  expect(html).not.toContain(storeId)
  expect(html).not.toContain(organizationId)
})

test('configures, persists, checks out and reloads secure tracking on mobile', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('zeno-order:cart:v1:tea-house', JSON.stringify({
      version: 1,
      publicSlug: 'tea-house',
      currency: 'VND',
      items: [],
    }))
  })
  await page.goto('/s/mochi-cafe')
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as Element & { __vue_app__?: unknown })?.__vue_app__))

  const coffeeCard = page.locator('[data-product-card]').filter({ hasText: 'Cà phê sữa đá' })
  await coffeeCard.getByRole('button', { name: 'Chọn món' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cà phê sữa đá' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('Lớn').check()
  await dialog.getByLabel('Trân châu').check()
  await dialog.getByLabel('Ghi chú cho món').fill('Ít đá')
  await dialog.getByRole('button', { name: /Thêm vào giỏ/ }).click()

  const cartBar = page.locator('[data-cart-bar]')
  await expect(cartBar).toContainText('1 món')
  await expect(cartBar).toContainText('55.000')
  const storageKeys = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('zeno-order:cart:'))
    .sort())
  expect(storageKeys).toEqual([
    'zeno-order:cart:v1:mochi-cafe',
    'zeno-order:cart:v1:tea-house',
  ])

  await page.reload()
  await expect(page.locator('[data-cart-bar]')).toContainText('1 món')
  await page.locator('[data-cart-bar]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Giỏ hàng')
  await expect(page.locator('[data-cart-item]')).toContainText('Lớn')
  await expect(page.locator('[data-cart-item]')).toContainText('Trân châu')
  await expect(page.locator('[data-cart-subtotal]')).toContainText('55.000')

  await page.locator('[data-checkout-link]').click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Thanh toán')
  await expect(page.locator('[data-checkout-total]')).toContainText('55.000')
  await page.getByLabel('Tên người nhận').fill('Khách thử nghiệm')
  await page.getByLabel('Số điện thoại').fill('0900000000')
  const submit = page.getByRole('button', { name: 'Đặt đơn', exact: true })
  await expect(submit).toBeEnabled({ timeout: 15_000 })
  await submit.click()

  await expect(page).toHaveURL(/\/s\/mochi-cafe\/order\/A\d+$/, { timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã nhận đơn')
  expect(await page.evaluate(() => window.location.hash)).toBe('')
  const trackingKeys = await page.evaluate(() => Object.keys(sessionStorage)
    .filter(key => key.startsWith('zeno-order:tracking:v1:mochi-cafe:')))
  expect(trackingKeys).toHaveLength(1)
  expect(await page.evaluate(key => sessionStorage.getItem(key)?.length, trackingKeys[0]!)).toBe(43)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Đã nhận đơn')
})

test('returns the same safe 404 for an unknown store', async ({ page, request }) => {
  const pageResponse = await page.goto('/s/cua-hang-khong-ton-tai')
  const catalogResponse = await request.get('/api/storefront/cua-hang-khong-ton-tai/catalog')
  const availabilityResponse = await request.get('/api/storefront/cua-hang-khong-ton-tai/availability')

  expect(pageResponse?.status()).toBe(404)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Không tìm thấy cửa hàng.')
  expect(catalogResponse.status()).toBe(404)
  expect(catalogResponse.headers()['cache-control']).toBe(catalogCachePolicy)
  expect(availabilityResponse.status()).toBe(404)
  expect(availabilityResponse.headers()['cache-control']).toBe('no-store')
  await expect(catalogResponse.json()).resolves.toEqual({
    error: {
      code: 'STORE_NOT_FOUND',
      message: 'Không tìm thấy cửa hàng.',
    },
  })
})

test('catalog API exposes only the cached public contract', async ({ request }) => {
  const response = await request.get('/api/storefront/mochi-cafe/catalog')
  const body = await response.json()
  const serialized = JSON.stringify(body)

  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe(catalogCachePolicy)
  expect(body.store).toMatchObject({
    publicSlug: 'mochi-cafe',
    name: 'Mochi Cafe',
    currency: 'VND',
  })
  expect(body.sections.map((section: { name: string }) => section.name)).toEqual([
    'Cà phê',
    'Trà trái cây',
    'Bánh ngọt',
  ])
  expect(body.products[0].basePrice).toBe('35000')
  expect(serialized).not.toContain(storeId)
  expect(serialized).not.toContain(organizationId)
  expect(serialized).not.toMatch(/storeId|organizationId|isSoldOut|manualOpenState|deliveryEnabled|pickupEnabled/)
})

test('availability API stays fresh and hides tenant identifiers', async ({ request }) => {
  const response = await request.get('/api/storefront/mochi-cafe/availability')
  const body = await response.json()
  const serialized = JSON.stringify(body)

  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(body.publicSlug).toBe('mochi-cafe')
  expect(body.products).toContainEqual({
    productId: '60000000-0000-0000-0000-000000000004',
    isAvailable: false,
  })
  expect(serialized).not.toContain(storeId)
  expect(serialized).not.toContain(organizationId)
  expect(serialized).not.toMatch(/storeId|organizationId|isSoldOut|manualOpenState/)
})

test('backward-compatible profile API remains safe and cacheable', async ({ request }) => {
  const response = await request.get('/api/storefront/mochi-cafe')
  const body = await response.json()

  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe(catalogCachePolicy)
  expect(body).toEqual({
    publicSlug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: 'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
    logoPath: null,
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  })
})
