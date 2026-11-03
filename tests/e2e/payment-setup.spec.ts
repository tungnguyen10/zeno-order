import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { orders, paymentAttempts, sepayIntegrations, stores } from '../../server/db/schema'
import { hashToken } from '../../server/utils/tokens'
import { openStore, seedCartJson, seedMenu } from '../support/checkout-fixtures'
import { expectNoHorizontalOverflow } from './support/layout'
import { signUpAndOnboard } from './support/owner'

const SECRET = 'e2e-hmac-secret-0123456789'

test.afterAll(async () => {
  await closeDb()
})

test('owner sets up bank transfer in few steps and a customer gets a correct, renewable QR', async ({ page }, testInfo) => {
  const { slug } = await signUpAndOnboard(page, testInfo, 'Trà Sữa Thanh Toán')

  // Owner: bank + number + name, one "Kiểm tra".
  await page.goto('/app/settings')
  await page.getByRole('tab', { name: 'Thanh toán' }).click()
  await page.getByRole('combobox', { name: 'Ngân hàng' }).click()
  await page.getByRole('option', { name: /ACB/ }).click()
  await page.getByLabel('Số tài khoản', { exact: true }).fill('1122 3344 55')
  await page.getByLabel('Tên chủ tài khoản').fill('NGUYEN VAN B')
  await page.getByRole('button', { name: 'Kiểm tra' }).click()

  const preview = page.getByTestId('payment-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByAltText('Mã QR kiểm tra 2.000đ')).toHaveAttribute('src', /bank=970416.*amount=2000.*des=ZOTEST0000/)
  await expect(preview).toContainText('NGUYEN VAN B')
  await expectNoHorizontalOverflow(page)
  await page.getByRole('button', { name: 'Đúng tên, xác nhận' }).click()
  await expect(page.getByText('Đã kiểm tra tài khoản')).toBeVisible()

  // Owner: connect SePay; the secret is write-only.
  await page.getByRole('button', { name: 'Kết nối SePay' }).click()
  await expect(page.getByLabel('URL webhook')).toHaveValue(/\/api\/webhooks\/sepay\/[A-Za-z0-9_-]{32}$/)
  await page.getByLabel('Secret Key (HMAC-SHA256)').fill(SECRET)
  await page.getByRole('button', { name: 'Lưu Secret' }).click()
  await expect(page.getByText('Đã lưu Secret Key').first()).toBeVisible()
  await expect(page.getByLabel('Secret Key (HMAC-SHA256)')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(SECRET)
  await expect(page.getByText('Chờ giao dịch đầu tiên từ SePay').first()).toBeVisible()

  // PR6 will record the first valid webhook; simulate it here.
  const [store] = await getDb().select().from(stores).where(eq(stores.slug, slug))
  await getDb().update(sepayIntegrations).set({ lastValidWebhookAt: new Date() }).where(eq(sepayIntegrations.orgId, store!.orgId))
  await page.reload()
  await page.getByRole('tab', { name: 'Thanh toán' }).click()
  await page.getByRole('button', { name: 'Bật nhận chuyển khoản' }).click()
  await expect(page.getByText('Sẵn sàng nhận chuyển khoản')).toBeVisible()
  await expect(page.locator('body')).not.toContainText(SECRET)
  await page.screenshot({ path: testInfo.outputPath('owner-payment-ready.png'), fullPage: true })

  // Customer: a BANK_QR order shows a correct QR.
  await openStore(store!.id)
  const menu = await seedMenu({ id: store!.id, orgId: store!.orgId })
  await page.goto(`/s/${slug}`)
  await page.evaluate(([key, value]) => localStorage.setItem(key!, value!), [`zeno:cart:${slug}`, seedCartJson(menu)])
  await page.reload()
  await page.getByTestId('cart-bar').click()
  await page.getByLabel('Tên của bạn').fill('Khách thanh toán')
  await page.getByLabel('Số điện thoại').fill('0912345678')
  await page.getByRole('radio', { name: /Chuyển khoản/ }).click()
  await page.getByRole('button', { name: /^Đặt món/ }).click()
  await expect(page).toHaveURL(/\/o\/[\w-]{43}$/)
  const guestToken = new URL(page.url()).pathname.split('/').at(-1)!

  await expect(page.getByRole('heading', { name: /Chuyển khoản để hoàn tất đơn/ })).toBeVisible()
  await expect(page.getByAltText('Mã QR chuyển khoản')).toHaveAttribute('src', /acc=1122334455&bank=970416&amount=70000&des=ZO[A-Z0-9]{8}/)
  await expect(page.getByTestId('payment-account')).toHaveText('1122334455')
  await expect(page.getByTestId('payment-countdown')).toContainText(/Còn 1[0-5]:/)
  await expectNoHorizontalOverflow(page)
  const firstContent = await page.getByTestId('payment-content').innerText()
  expect(firstContent).toMatch(/^ZO[A-Z0-9]{8}$/)
  await page.screenshot({ path: testInfo.outputPath('customer-payment-qr.png'), fullPage: true })

  // The code lapses: the customer can create a new one, and the old row is kept.
  const [order] = await getDb().select().from(orders).where(eq(orders.guestTokenHash, hashToken(guestToken)))
  await getDb().update(paymentAttempts).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentAttempts.orderId, order!.id))
  await page.reload()
  await expect(page.getByText('Mã QR đã hết hạn')).toBeVisible()
  await page.getByRole('button', { name: 'Tạo mã mới' }).click()
  await expect(page.getByAltText('Mã QR chuyển khoản')).toBeVisible()
  await expect(page.getByTestId('payment-content')).not.toHaveText(firstContent)
  const rows = await getDb().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order!.id))
  expect(rows.map(r => r.status).sort()).toEqual(['PENDING', 'SUPERSEDED'])
})
