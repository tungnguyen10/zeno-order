import { expect, type Page, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { getDb } from '../../../server/db/client'
import { orderEvents, stores } from '../../../server/db/schema'
import { createOrderItem, createOrderRow } from '../../support/order-fixtures'

export const PASSWORD = 'E2e-Password-123'

export const stampOf = (testInfo: TestInfo, tag = '') =>
  `${Date.now().toString(36)}${tag}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}`

export async function signUpAndOnboard(page: Page, opts: { name: string, email: string, storeName: string, slug: string }) {
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill(opts.name)
  await page.getByLabel('Email').fill(opts.email)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill(`${opts.storeName} Group`)
  await page.getByLabel('Tên cửa hàng').fill(opts.storeName)
  await page.getByLabel('Đường dẫn cửa hàng').fill(opts.slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
}

export async function seedCodOrder(slug: string, overrides: Parameters<typeof createOrderRow>[1] = {}) {
  const [store] = await getDb().select().from(stores).where(eq(stores.slug, slug))
  if (!store) throw new Error(`Store ${slug} not found`)
  const order = await createOrderRow(store, overrides)
  await createOrderItem(order, { nameSnapshot: 'Trà đào cam sả', qty: 2, lineTotalVnd: order.totalVnd })
  return order
}

export async function countEvents(orderId: string): Promise<number> {
  return (await getDb().select().from(orderEvents).where(eq(orderEvents.orderId, orderId))).length
}
