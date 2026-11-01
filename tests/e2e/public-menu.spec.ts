import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { stores } from '../../server/db/schema'
import { createCategory, createProduct, createTenant } from '../support/fixtures'
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
