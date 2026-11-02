import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createCategory, createOptionGroup, createProduct, createTable, createTenant } from '../support/fixtures'
import { assertTestDatabase, loadEnvFileOverride } from '../support/test-env'
import { expectNoHorizontalOverflow } from './support/layout'

loadEnvFileOverride('.env.test')
assertTestDatabase()

test.afterAll(async () => {
  await closeDb()
})

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 })
})

test('a store with no menu shows the updating state and the paused badge', async ({ page }) => {
  const t = await createTenant('e2e-empty')
  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
  await expect(page.getByText('Tạm nghỉ', { exact: true })).toBeVisible()
  await expect(page.getByText('Menu đang được cập nhật')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('an accepting store lists products by category and flags sold-out items', async ({ page }) => {
  const t = await createTenant('e2e-menu')
  await getDb().update(stores).set({ isAcceptingOrders: true }).where(eq(stores.id, t.store.id))
  const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
  await createProduct(t.store, { name: 'Trà sữa trân châu', basePriceVnd: 35000, categoryId: tea.id, position: 1 })
  await createProduct(t.store, { name: 'Cà phê muối', basePriceVnd: 29000, isAvailable: false, position: 2 })

  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByText('Đang nhận đơn', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Trà sữa' })).toBeVisible()
  await expect(page.getByText('35.000đ')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'Cà phê muối' }).getByText('Hết hàng')).toBeVisible()
  await expect(page.getByText('Menu đang được cập nhật')).toBeHidden()
  if (test.info().project.name === 'mobile-chrome') await page.screenshot({ path: '/tmp/zeno-pr2-menu-early.png', fullPage: true })
  await expectNoHorizontalOverflow(page)
})

test('an upper-case slug opens the same store', async ({ page }) => {
  const t = await createTenant('e2e-case')
  await page.goto(`/s/${t.store.slug.toUpperCase()}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
})

test('an unknown slug returns 404 with the not-found page', async ({ page }) => {
  const response = await page.goto('/s/khong-ton-tai-xyz')
  expect(response?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible()
})

async function openStore(opts: { accepting?: boolean } = {}) {
  const t = await createTenant('e2e-cx')
  if (opts.accepting ?? true) await getDb().update(stores).set({ isAcceptingOrders: true }).where(eq(stores.id, t.store.id))
  return t
}

async function waitForPublicMenuHydration(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: unknown }) | null)?.__vue_app__))
}

async function navigateWithinApp(page: import('@playwright/test').Page, path: string) {
  await page.evaluate((url) => {
    window.history.pushState({}, '', url)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

test('customer picks options with defaults, sees live prices and fills the draft cart', async ({ page }) => {
  const t = await openStore()
  const tea = await createProduct(t.store, { name: 'Trà sữa', basePriceVnd: 30000, position: 1 })
  await createOptionGroup(t.store, tea, { name: 'Size', required: true, values: [{ name: 'M' }, { name: 'L', priceDeltaVnd: 5000 }] })
  await createOptionGroup(t.store, tea, { name: 'Topping', maxSelect: 2, position: 1, values: [{ name: 'Trân châu', priceDeltaVnd: 5000 }, { name: 'Thạch', priceDeltaVnd: 3000 }, { name: 'Pudding', priceDeltaVnd: 7000 }] })
  await createProduct(t.store, { name: 'Bánh flan', basePriceVnd: 20000, position: 2 })

  await page.goto(`/s/${t.store.slug}`)
  await waitForPublicMenuHydration(page)
  await page.getByRole('button', { name: 'Thêm Trà sữa' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Thêm • 30.000đ' })).toBeVisible()
  await expect(dialog.getByRole('radio', { name: /^M/ })).toBeChecked()
  await dialog.getByText('L', { exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 35.000đ' })).toBeVisible()
  await dialog.getByText('Trân châu').click()
  await dialog.getByText('Thạch').click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 43.000đ' })).toBeVisible()
  await dialog.getByText('Pudding').click()
  await expect(dialog.getByRole('checkbox', { name: /Pudding/ })).not.toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Thêm • 43.000đ' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Tăng số lượng' }).click()
  await expect(dialog.getByRole('button', { name: 'Thêm • 86.000đ' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Thêm • 86.000đ' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Giỏ • 2 món')).toBeVisible()
  await page.getByRole('button', { name: 'Thêm Bánh flan' }).click()
  await expect(page.getByText('Giỏ • 3 món')).toBeVisible()
  await expect(page.getByText('106.000đ', { exact: true })).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('required options stay selected when tapped again', async ({ page }) => {
  const t = await openStore()
  const coffee = await createProduct(t.store, { name: 'Cà phê' })
  await createOptionGroup(t.store, coffee, { name: 'Đường', required: true, values: [{ name: '100%' }, { name: '50%' }] })
  await page.goto(`/s/${t.store.slug}`)
  await waitForPublicMenuHydration(page)
  await page.getByRole('button', { name: 'Thêm Cà phê' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('radio', { name: '100%' })).toBeChecked()
  await dialog.getByText('50%').click()
  await expect(dialog.getByRole('radio', { name: '50%' })).toBeChecked()
  await dialog.getByText('50%').click()
  await expect(dialog.getByRole('radio', { name: '50%' })).toBeChecked()
})

test('search appears only above 15 products and filters without diacritics', async ({ page }) => {
  const small = await openStore()
  for (let i = 1; i <= 15; i++) await createProduct(small.store, { name: `Món số ${i}`, position: i })
  await page.goto(`/s/${small.store.slug}`)
  await expect(page.getByText('Món số 15')).toBeVisible()
  await expect(page.getByLabel('Tìm món')).toHaveCount(0)

  const big = await openStore()
  for (let i = 1; i <= 15; i++) await createProduct(big.store, { name: `Món số ${i}`, position: i })
  await createProduct(big.store, { name: 'Bánh flan caramel', position: 16 })
  await page.goto(`/s/${big.store.slug}`)
  await waitForPublicMenuHydration(page)
  await page.getByLabel('Tìm món').fill('BANH flan')
  await expect(page.getByText('Bánh flan caramel')).toBeVisible()
  await expect(page.getByText('Món số 3', { exact: true })).toBeHidden()
  await page.getByLabel('Tìm món').fill('khong co mon nay')
  await expect(page.getByText('Không tìm thấy món')).toBeVisible()
})

test('category chips list every non-empty category', async ({ page }) => {
  const t = await openStore()
  const tea = await createCategory(t.store, 'Trà sữa', { position: 1 })
  const coffee = await createCategory(t.store, 'Cà phê', { position: 2 })
  await createCategory(t.store, 'Rỗng', { position: 3 })
  await createProduct(t.store, { name: 'Trà đào', categoryId: tea.id })
  await createProduct(t.store, { name: 'Bạc xỉu', categoryId: coffee.id })
  await page.goto(`/s/${t.store.slug}`)
  await waitForPublicMenuHydration(page)
  const chips = page.getByRole('navigation', { name: 'Danh mục' })
  await expect(chips.getByRole('button')).toHaveText(['Trà sữa', 'Cà phê'])
  await chips.getByRole('button', { name: 'Cà phê' }).click()
  await expect(chips.getByRole('button', { name: 'Cà phê' })).toHaveAttribute('aria-current', 'true')
})

test('a paused store and a sold-out product cannot be added', async ({ page }) => {
  const paused = await openStore({ accepting: false })
  await createProduct(paused.store, { name: 'Trà đào' })
  await page.goto(`/s/${paused.store.slug}`)
  await expect(page.getByRole('button', { name: 'Thêm Trà đào' })).toBeDisabled()

  const open = await openStore()
  await createProduct(open.store, { name: 'Hết rồi', isAvailable: false })
  await page.goto(`/s/${open.store.slug}`)
  await expect(page.getByRole('button', { name: 'Thêm Hết rồi' })).toBeDisabled()
})

test('a table QR binds its table and broken QR tokens never do', async ({ page }) => {
  const t = await openStore()
  const { token } = await createTable(t.store, '05')
  await page.goto(`/s/${t.store.slug}?t=${token}`)
  await expect(page.getByText('Bàn 05', { exact: true })).toBeVisible()
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()

  for (const query of ['?t=sai-roi', '?t=', '?t=a&t=b', `?t=${'x'.repeat(300)}`]) {
    await page.goto(`/s/${t.store.slug}${query}`)
    await expect(page.getByText(/Mã QR không hợp lệ/)).toBeVisible()
    await expect(page.getByText('Bàn 05', { exact: true })).toBeHidden()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.store.name)
  }

  await page.goto(`/s/${t.store.slug}`)
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()
  await expect(page.getByText('Bàn 05', { exact: true })).toBeHidden()
})

test('SPA store navigation refreshes fulfillment and keeps each draft cart scoped', async ({ page }) => {
  const storeA = await openStore()
  await createProduct(storeA.store, { name: 'Món A', basePriceVnd: 10000 })
  const tableA = await createTable(storeA.store, '11', { displayName: 'Bàn 11' })

  const storeB = await openStore()
  await createProduct(storeB.store, { name: 'Món B', basePriceVnd: 25000 })
  const tableB = await createTable(storeB.store, '22', { displayName: 'Bàn 22' })

  await page.goto(`/s/${storeA.store.slug}?t=${tableA.token}`)
  await waitForPublicMenuHydration(page)
  await expect(page.getByText('Bàn 11', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Thêm Món A' }).click()
  await expect(page.getByText('Giỏ • 1 món')).toBeVisible()
  await expect(page.getByText('10.000đ', { exact: true }).last()).toBeVisible()

  await navigateWithinApp(page, `/s/${storeB.store.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(storeB.store.name)
  await expect(page.getByText('Bàn 11', { exact: true })).toBeHidden()
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()
  await expect(page.getByRole('button', { name: 'Thêm Món B' })).toBeVisible()
  await expect(page.getByText('Giỏ • 1 món')).toBeHidden()
  await page.getByRole('button', { name: 'Thêm Món B' }).click()
  await expect(page.getByText('Giỏ • 1 món')).toBeVisible()
  await expect(page.getByText('25.000đ', { exact: true }).last()).toBeVisible()

  await navigateWithinApp(page, `/s/${storeB.store.slug}?t=${tableA.token}`)
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeVisible()
  await expect(page.getByText('Bàn 11', { exact: true })).toBeHidden()
  await navigateWithinApp(page, `/s/${storeB.store.slug}?t=${tableB.token}`)
  await expect(page.getByText('Bàn 22', { exact: true })).toBeVisible()
  await expect(page.getByText(/Mã QR không hợp lệ/)).toBeHidden()

  await navigateWithinApp(page, `/s/${storeA.store.slug}`)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(storeA.store.name)
  await expect(page.getByText('Giỏ • 1 món')).toBeVisible()
  await expect(page.getByText('10.000đ', { exact: true }).last()).toBeVisible()
  await expect(page.getByText('25.000đ', { exact: true })).toBeHidden()
})
