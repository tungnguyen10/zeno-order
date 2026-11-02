import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test'
import { count, eq } from 'drizzle-orm'
import { getDb } from '../../server/db/client'
import { deliveryZones, orderItems, orders, products, stores } from '../../server/db/schema'
import { openStore, seedCartJson, seedMenu, type SeededMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

async function seed(testInfo: TestInfo) {
  const tenant = await createTenant(`ord${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`)
  await openStore(tenant.store.id, { deliveryEnabled: true })
  return { store: tenant.store, menu: await seedMenu(tenant.store) }
}

// Most specs seed the cart exactly as useCart persists it, so each one exercises a single checkout
// behaviour; one spec below adds products through the real PR2 menu UI.
async function openMenuWithCart(page: Page, slug: string, menu: SeededMenu, query = '') {
  await page.goto(`/s/${slug}${query}`)
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [`zeno:cart:${slug}`, seedCartJson(menu)])
  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('2 món')
}

const ordersOf = async (storeId: string) =>
  (await getDb().select({ n: count() }).from(orders).where(eq(orders.storeId, storeId)))[0]!.n

const placeButton = (page: Page) => page.getByRole('button', { name: /^Đặt món/ })

async function expectTouchTarget(locator: Locator) {
  await expect(locator).toBeVisible()
  expect((await locator.boundingBox())!.height).toBeGreaterThanOrEqual(44)
}

async function fillPickup(page: Page) {
  await page.getByLabel('Tên của bạn').fill('Lan')
  await page.getByLabel('Số điện thoại').fill('0912 345 678')
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('pickup: fill name and phone, place the order, land on tracking, cart is emptied', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  await page.getByTestId('cart-bar').click()
  await expect(page.getByRole('radio', { name: 'Mang đi' })).toHaveAttribute('aria-checked', 'true')
  await fillPickup(page)
  await expect(page.getByTestId('checkout-total')).toHaveText('70.000đ')
  await expectNoHorizontalOverflow(page)
  await expectTouchTarget(placeButton(page))
  await expectTouchTarget(page.getByRole('button', { name: 'Tăng số lượng Trà sữa trân châu' }))

  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByTestId('order-public-code')).toBeVisible()
  await expect(page.getByTestId('order-status')).toHaveText('Đã gửi quán')
  await expect(page.locator('meta[name=referrer]')).toHaveAttribute('content', 'no-referrer')
  const poll = await page.waitForRequest(request => request.url().includes('/api/public/orders/'))
  // Browser engines expose an omitted referrer as either an absent header or an empty value.
  expect(poll.headers().referer ?? '').toBe('')

  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'PICKUP', customerPhone: '0912345678', status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })

  await page.goto(`/s/${store.slug}`)
  await expect(page.getByTestId('cart-bar')).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Đơn gần đây' })).toContainText(`#${row!.publicCode}`)
})

test('dine-in via QR: no form at all, open the cart and place', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu, `?t=${menu.table.token}`)

  await page.getByTestId('cart-bar').click()
  await expect(page.getByRole('radio', { name: 'Tại bàn · Bàn 05' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Số điện thoại')).not.toBeVisible()
  await placeButton(page).click()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByText('Bàn 05')).toBeVisible()
  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'DINE_IN', tableId: menu.table.id, customerPhone: null })
})

test('delivery: zone, address, fee in the total, address never shown back to the customer', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  await page.getByTestId('cart-bar').click()
  await page.getByRole('radio', { name: 'Giao hàng' }).click()
  await fillPickup(page)
  await page.getByRole('combobox', { name: 'Khu vực giao' }).click()
  await page.getByRole('option', { name: /Quận 1/ }).click()
  await page.getByLabel('Địa chỉ chi tiết').fill('12 Lê Lợi, Quận 1')
  await expect(page.getByTestId('checkout-total')).toHaveText('85.000đ')
  await expectNoHorizontalOverflow(page)
  await placeButton(page).click()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  await expect(page.getByText('Giao hàng · Quận 1')).toBeVisible()
  await expect(page.getByText('*******678')).toBeVisible()
  await expect(page.getByText('12 Lê Lợi')).toHaveCount(0)
  const [row] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(row).toMatchObject({ fulfillmentType: 'DELIVERY', addressSnapshot: '12 Lê Lợi, Quận 1', deliveryFeeVnd: 15_000, totalVnd: 85_000 })
})

test('adds from the real menu UI (option sheet + one-tap product), then checks out', async ({ page }, testInfo) => {
  const { store } = await seed(testInfo)
  await page.goto(`/s/${store.slug}`)
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__))

  await page.getByRole('button', { name: 'Thêm Trà sữa trân châu' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Ghi chú cho món').fill('Ít ngọt')
  await dialog.getByRole('button', { name: 'Thêm • 35.000đ' }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: 'Thêm Bánh mì que' }).click()
  await expect(page.getByTestId('cart-bar')).toContainText('Giỏ • 2 món')

  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await expect(page.getByTestId('checkout-total')).toHaveText('55.000đ')
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)

  const items = await getDb().select().from(orderItems).where(eq(orderItems.storeId, store.id)).orderBy(orderItems.position)
  expect(items.map(item => [item.nameSnapshot, item.qty, item.optionsSnapshotJson.map(option => option.valueName)])).toEqual([
    ['Trà sữa trân châu', 1, ['M']],
    ['Bánh mì que', 1, []],
  ])
  expect(items[0]!.note).toBe('Ít ngọt')
})

test('inline validation: bad phone and empty name block the request', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await page.getByLabel('Số điện thoại').fill('0212345678')
  await placeButton(page).click()

  await expect(page.getByText('Vui lòng nhập tên')).toBeVisible()
  await expect(page.getByText('Số điện thoại không hợp lệ')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)
})

test('the cart survives a reload and edits are persisted', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await page.getByLabel('Tên của bạn').fill('L'.repeat(81))
  await expect(page.getByLabel('Tên của bạn')).toHaveValue('L'.repeat(80))
  await page.getByRole('button', { name: 'Tăng số lượng Trà sữa trân châu' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('cart-bar')).toContainText('3 món')

  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('3 món')
})

test('double tap on "Đặt món" creates exactly one order (Review Focus #8)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await placeButton(page).dblclick()

  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  expect(await ordersOf(store.id)).toBe(1)
})

test('a lost response followed by a retry yields the same single order (Review Focus #8)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)

  let dropped = false
  await page.route('**/api/public/stores/*/orders', async (route) => {
    if (dropped) return route.continue()
    dropped = true
    await route.fetch()
    await route.abort('failed')
  })

  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await placeButton(page).click()
  await expect(page.getByText('Mất kết nối')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(1)

  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  expect(await ordersOf(store.id)).toBe(1)
})

test('price changed in the meantime: server price wins, the customer confirms the new price (Review Focus #7)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(products).set({ basePriceVnd: 38_000 }).where(eq(products.id, menu.tea.id))

  await placeButton(page).click()
  await expect(page.getByText('Một số món đã thay đổi')).toBeVisible()
  await expect(page.getByText('Giá mới 38.000đ')).toBeVisible()
  await expect(placeButton(page)).toBeDisabled()
  expect(await ordersOf(store.id)).toBe(0)

  await page.getByRole('button', { name: 'Cập nhật giá' }).click()
  await expect(page.getByTestId('checkout-total')).toHaveText('76.000đ')
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)

  const items = await getDb().select().from(orderItems).where(eq(orderItems.storeId, store.id))
  expect(items.map(item => item.unitPriceVnd)).toEqual([38_000])
})

test('a sold-out product is flagged and the cart can be emptied', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(products).set({ isAvailable: false }).where(eq(products.id, menu.tea.id))

  await placeButton(page).click()
  await expect(page.getByText('Món này đã hết')).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)

  await page.getByRole('button', { name: 'Xóa Trà sữa trân châu' }).click()
  await expect(page.getByText('Giỏ hàng trống')).toBeVisible()
})

test('the store closing mid-checkout shows a clear message and keeps the cart (Review Focus #4)', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await fillPickup(page)
  await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, store.id))

  await placeButton(page).click()
  await expect(page.getByText('Quán đang tạm nghỉ').first()).toBeVisible()
  expect(await ordersOf(store.id)).toBe(0)

  await page.reload()
  await expect(page.getByTestId('cart-bar')).toContainText('2 món')
})

test('a delivery fee change refreshes the total and requires confirmation before creating an order', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu)
  await page.getByTestId('cart-bar').click()
  await page.getByRole('radio', { name: 'Giao hàng' }).click()
  await fillPickup(page)
  await page.getByLabel('Địa chỉ chi tiết').fill('12 Lê Lợi')
  await getDb().update(deliveryZones).set({ feeVnd: 20_000 }).where(eq(deliveryZones.id, menu.zone.id))

  await placeButton(page).click()
  await expect(page.getByText('Phí giao hoặc tổng tiền đã thay đổi')).toBeVisible()
  await expect(page.getByTestId('checkout-total')).toHaveText('90.000đ')
  expect(await ordersOf(store.id)).toBe(0)
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  const [order] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(order).toMatchObject({ deliveryFeeVnd: 20_000, totalVnd: 90_000 })
})

test('disabling dine-in while checking out lets the customer switch to pickup', async ({ page }, testInfo) => {
  const { store, menu } = await seed(testInfo)
  await openMenuWithCart(page, store.slug, menu, `?t=${menu.table.token}`)
  await page.getByTestId('cart-bar').click()
  await getDb().update(stores).set({ dineInEnabled: false }).where(eq(stores.id, store.id))

  await placeButton(page).click()
  await expect(page.getByText('Quán không nhận đơn theo hình thức này lúc này')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mang đi' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: /Tại bàn/ })).toHaveCount(0)
  expect(await ordersOf(store.id)).toBe(0)
  await fillPickup(page)
  await placeButton(page).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  const [order] = await getDb().select().from(orders).where(eq(orders.storeId, store.id))
  expect(order).toMatchObject({ fulfillmentType: 'PICKUP', tableId: null })
})
