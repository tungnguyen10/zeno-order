import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { closeDb, getDb } from '../../server/db/client'
import { orderPayments, orders, stores } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { bankTxInput, bodyOf, createAwaitingOrder, createPaymentSetup, sepayPayload, signSepayBody, type PaymentSetup } from '../support/webhook-fixtures'
import { expectNoHorizontalOverflow } from './support/layout'

const PASSWORD = 'E2e-Password-123'
const db = () => getDb()

test.afterAll(async () => {
  await closeDb()
})

async function signUpAndOnboard(page: Page, testInfo: TestInfo) {
  const stamp = `${Date.now().toString(36)}${testInfo.project.name === 'mobile-safari' ? 's' : 'c'}pw`
  const slug = `e2e-${stamp}`
  await page.setViewportSize({ width: 360, height: 740 })
  await page.goto('/signup')
  await page.getByLabel('Tên của bạn').fill('Chủ Quán Thanh Toán')
  await page.getByLabel('Email').fill(`e2e+ci${process.env.GITHUB_RUN_ID ?? 'local'}-${stamp}@example.com`)
  await page.getByLabel('Mật khẩu', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Tạo tài khoản' }).click()
  await expect(page).toHaveURL(/\/onboarding$/)
  await page.getByLabel('Tên doanh nghiệp').fill('Thanh Toán Group')
  await page.getByLabel('Tên cửa hàng').fill('Quán Chuyển Khoản')
  await page.getByLabel('Đường dẫn cửa hàng').fill(slug)
  await page.getByRole('button', { name: 'Tạo cửa hàng' }).click()
  await expect(page).toHaveURL(/\/app\/orders$/)
  const [store] = await db().select().from(stores).where(eq(stores.slug, slug))
  return createPaymentSetup({ org: { id: store!.orgId }, store: { id: store!.id, orgId: store!.orgId } })
}

async function sendWebhook(request: APIRequestContext, setup: PaymentSetup, payload: unknown) {
  const raw = bodyOf(payload)
  return request.post(`/api/webhooks/sepay/${setup.integration.webhookEndpointKey}`, {
    data: raw,
    headers: { 'content-type': 'application/json', ...signSepayBody(raw, setup.secret) },
  })
}

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!

test('a correct signed transfer confirms the order exactly once, even when delivered repeatedly', async ({ page, request }, testInfo) => {
  const setup = await signUpAndOnboard(page, testInfo)
  const { order, attempt, guestToken } = await createAwaitingOrder(setup, { amountVnd: 55_000 })

  const tracking = await request.get(`/api/public/orders/${guestToken}`)
  expect((await tracking.json()).status).toBe('AWAITING_PAYMENT')

  const payload = sepayPayload(setup, { code: attempt.paymentCode, transferAmount: 55_000 })
  const responses = await Promise.all([1, 2, 3].map(() => sendWebhook(request, setup, payload)))
  for (const res of responses) {
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ success: true })
  }

  await expect.poll(async () => (await (await request.get(`/api/public/orders/${guestToken}`)).json()).status).toBe('NEW')
  expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
  expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))).toHaveLength(1)

  const tampered = await request.post(`/api/webhooks/sepay/${setup.integration.webhookEndpointKey}`, {
    data: bodyOf(payload),
    headers: { 'content-type': 'application/json', 'x-sepay-timestamp': String(Math.floor(Date.now() / 1000)), 'x-sepay-signature': 'sha256=00' },
  })
  expect(tampered.status()).toBe(401)
})

test('owner resolves unmatched money and a refund from the reconciliation screen on a phone', async ({ page, request }, testInfo) => {
  const setup = await signUpAndOnboard(page, testInfo)
  const awaiting = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
  const cancelled = await createAwaitingOrder(setup, { amountVnd: 40_000, orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })

  // Customer forgot the code: money for the awaiting order arrives with no payment code.
  const noCode = await sendWebhook(request, setup, sepayPayload(setup, { code: null, content: 'ck tra sua', transferAmount: 70_000 }))
  expect(noCode.status()).toBe(200)
  // Money arrives for an order that was already cancelled.
  const late = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: cancelled.attempt.paymentCode, amountVnd: 40_000 }))
  await matchTransaction(db(), late.id)

  await page.getByRole('link', { name: /Đối soát/ }).click()
  await expect(page).toHaveURL(/\/app\/reconciliation$/)
  await expectNoHorizontalOverflow(page)

  const assign = page.getByRole('button', { name: `Gán vào đơn #${awaiting.order.publicCode}` })
  await expect(assign).toBeVisible()
  expect((await assign.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await assign.dblclick()
  await expect(page.getByText('Đã gán vào đơn')).toBeVisible()
  await expect.poll(async () => (await orderRow(awaiting.order.id)).paymentStatus).toBe('PAID')
  expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, awaiting.order.id))).toHaveLength(1)

  await page.getByRole('tab', { name: /Hoàn tiền/ }).click()
  await expect(page.getByText(/Cần hoàn 40\.000đ/)).toBeVisible()
  await page.getByRole('button', { name: 'Đã hoàn tiền' }).click()
  await page.getByRole('button', { name: 'Xác nhận' }).click()
  await expect.poll(async () => (await orderRow(cancelled.order.id)).paymentStatus).toBe('REFUNDED')
  await expectNoHorizontalOverflow(page)
})
