import { randomInt } from 'node:crypto'
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { orders } from '../../server/db/schema'
import { deliveryBody, openStore, pickupBody, seedMenu, teaItem } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

async function seed(testInfo: TestInfo) {
  const tenant = await createTenant(`trk${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`)
  await openStore(tenant.store.id, { deliveryEnabled: true })
  return { store: tenant.store, menu: await seedMenu(tenant.store) }
}

// A distinct client ip per call keeps parallel specs clear of the checkout rate limit.
async function placeOrder(request: APIRequestContext, slug: string, body: unknown) {
  const res = await request.post(`/api/public/stores/${slug}/orders`, {
    data: body,
    headers: { 'x-forwarded-for': `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}` },
  })
  expect(res.status()).toBe(201)
  return (await res.json()) as { guestToken: string, publicCode: string }
}

async function waitForHydration(page: Page) {
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__))
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('shows code, progress, masked contact and totals, and follows status changes', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const created = await placeOrder(request, store.slug, deliveryBody(menu))

  await page.goto(`/o/${created.guestToken}`)
  await waitForHydration(page)
  await expect(page.getByTestId('order-public-code')).toHaveText(`#${created.publicCode}`)
  await expect(page.getByTestId('order-status')).toHaveText('Đã gửi quán')
  await expect(page.getByText('Giao hàng · Quận 1')).toBeVisible()
  await expect(page.getByText('Trà sữa trân châu')).toBeVisible()
  await expect(page.getByText('85.000đ').first()).toBeVisible()
  await expect(page.getByText('*******678')).toBeVisible()
  await expect(page.getByText('Trả tiền khi nhận món')).toBeVisible()
  await expect(page.getByText('0912345678')).toHaveCount(0)
  await expect(page.getByText('12 Lê Lợi')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

  await getDb().update(orders).set({ status: 'PREPARING' }).where(eq(orders.publicCode, created.publicCode))
  await expect(page.getByTestId('order-status')).toHaveText('Quán đang làm món', { timeout: 12_000 })

  await getDb().update(orders).set({ status: 'CANCELLED' }).where(eq(orders.publicCode, created.publicCode))
  await expect(page.getByText('Quán đã hủy đơn này')).toBeVisible({ timeout: 12_000 })
  await expect(page.getByRole('list', { name: 'Tiến độ đơn hàng' })).toHaveCount(0)
})

test('renders customer text as text, and ships no-referrer + noindex headers (Review Focus #2, #3)', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const note = '<img src=x onerror="window.__xss=1">'
  const created = await placeOrder(request, store.slug, pickupBody(menu, { items: [teaItem(menu, { note })] }))

  const response = await page.goto(`/o/${created.guestToken}`)
  await waitForHydration(page)
  expect(response!.headers()['referrer-policy']).toBe('no-referrer')
  expect(response!.headers()['x-robots-tag']).toContain('noindex')
  await expect(page.getByText(note, { exact: false })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined()
  expect(await page.locator('img[src="x"]').count()).toBe(0)
})

test('shows the copyable tracking link so the customer can save it', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const created = await placeOrder(request, store.slug, pickupBody(menu))
  await page.goto(`/o/${created.guestToken}`)
  await waitForHydration(page)
  await expect(page.getByLabel('Link theo dõi đơn')).toHaveValue(new RegExp(`/o/${created.guestToken}$`))
  await expect(page.getByRole('link', { name: 'Đặt thêm món' })).toHaveAttribute('href', `/s/${store.slug}`)
})

test('an unknown token shows a friendly empty state instead of an error page', async ({ page }) => {
  await page.goto(`/o/${'a'.repeat(43)}`)
  await waitForHydration(page)
  await expect(page.getByRole('heading', { name: 'Không tìm thấy đơn hàng' })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('an initial connection failure offers retry and recovers the order', async ({ page, request }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  const created = await placeOrder(request, store.slug, pickupBody(menu))
  const endpoint = `**/api/public/orders/${created.guestToken}`
  await page.route(endpoint, route => route.abort('failed'))
  await page.goto(`/o/${created.guestToken}`)
  await waitForHydration(page)
  await expect(page.getByText('Chưa tải được đơn hàng')).toBeVisible()
  await page.unroute(endpoint)
  await page.getByRole('button', { name: 'Thử lại' }).click()
  await expect(page.getByTestId('order-public-code')).toHaveText(`#${created.publicCode}`)
  await expect(page.getByText('Chưa tải được đơn hàng')).toHaveCount(0)
})
