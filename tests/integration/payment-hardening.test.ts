import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactionIdentities, bankTransactions, orderPayments, orders, paymentAttempts, reconcileCheckpoints } from '../../server/db/schema'
import { createReplacementAttempt } from '../../server/services/payments/attempts'
import { cancelOrderIfStillUnpaid } from '../../server/services/payments/expire-payment-attempts'
import { markOrderRefunded } from '../../server/services/payments/manual-payments'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { assignTransactionToOrder, resolveTransaction } from '../../server/services/payments/review-queue'
import { withPaymentJobLease } from '../../server/services/payments/job-lease'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup } from '../support/webhook-fixtures'

const db = () => getDb()
let tenant: Awaited<ReturnType<typeof createTenant>>
let setup: Awaited<ReturnType<typeof createPaymentSetup>>
const ctx = () => ({ orgId: setup.orgId, storeId: setup.storeId, userId: tenant.owner.userId })
const row = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!
async function receive(code: string, overrides: Parameters<typeof bankTxInput>[1] = {}) {
  const bt = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: code, ...overrides }))
  await matchTransaction(db(), bt.id)
  return bt.id
}
beforeEach(async () => { await resetDb(); tenant = await createTenant('hardening'); setup = await createPaymentSetup(tenant, { apiToken: 'test-token' }) })
afterEach(() => { delete process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS })
afterAll(closeDb)

describe('payment invariants independent of scheduler timing', () => {
  it('detects late payment without relying on cron to mark the attempt EXPIRED', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { expiresAt: new Date(Date.now() - 60_000) })
    await receive(attempt.paymentCode)
    expect(await row(order.id)).toMatchObject({ paymentStatus: 'PAID', latePayment: true })
  })
  it('does not pay against the wrong VA even if the main account matches', async () => {
    const va = await createPaymentSetup(await createTenant('va'), { vaNumber: 'VA12345' })
    const { order, attempt } = await createAwaitingOrder(va)
    const bt = await recordBankTransaction(db(), bankTxInput(va, { paymentCode: attempt.paymentCode, subAccount: 'OTHER-VA' }))
    expect(await matchTransaction(db(), bt.id)).toMatchObject({ kind: 'REVIEW', reason: 'ACCOUNT_MISMATCH' })
    expect((await row(order.id)).paymentStatus).not.toBe('PAID')
  })
  it('cannot auto-match or manually assign test integration money to a real order', async () => {
    const test = await createPaymentSetup(await createTenant('test'), { environment: 'test' })
    const made = await createAwaitingOrder(test)
    const bt = await recordBankTransaction(db(), bankTxInput(test, { paymentCode: made.attempt.paymentCode }))
    expect(await matchTransaction(db(), bt.id)).toMatchObject({ kind: 'REVIEW' })
    await expect(assignTransactionToOrder(db(), { orgId: test.orgId, userId: tenant.owner.userId }, { transactionId: bt.id, orderId: made.order.id, acceptAmountDifference: false })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    expect((await row(made.order.id)).paymentStatus).not.toBe('PAID')
  })
  it('preserves webhook/API reports when identity mapping is not verified', async () => {
    const input = bankTxInput(setup, { referenceCode: 'SAME' })
    const one = await recordBankTransaction(db(), input)
    const two = await recordBankTransaction(db(), { ...input, providerTransactionId: 'api-uuid', source: 'RECONCILE' })
    expect(one.id).not.toBe(two.id)
    expect(await db().select().from(bankTransactionIdentities)).toHaveLength(2)
  })
  it('does not infer aliases from a missing reference even after enabling the integration gate', async () => {
    process.env.SEPAY_VERIFIED_DEDUPE_INTEGRATIONS = setup.integration.id
    const input = bankTxInput(setup, { referenceCode: null })
    const one = await recordBankTransaction(db(), input)
    const two = await recordBankTransaction(db(), { ...input, source: 'RECONCILE', providerTransactionId: 'api-uuid' })
    expect(one.id).not.toBe(two.id)
  })
  it('has no deadlock between QR replacement and an expired-code payment', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { expiresAt: new Date(Date.now() - 60_000) })
    const bt = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    const results = await Promise.allSettled([
      createReplacementAttempt(db(), { orgId: setup.orgId, storeId: setup.storeId, orderId: order.id }),
      matchTransaction(db(), bt.id),
    ])
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    expect((await row(order.id)).paymentStatus).toBe('PAID')
    expect(await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))).toHaveLength(1)
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))).filter(a => a.status === 'PENDING')).toHaveLength(0)
  })
  it('will not cancel using an incomplete historical coverage window', async () => {
    const now = new Date()
    const { order } = await createAwaitingOrder(setup, { createdAt: new Date(now.getTime() - 48 * 3_600_000), attemptStatus: 'EXPIRED', expiresAt: new Date(now.getTime() - 47 * 3_600_000) })
    await db().update(paymentAttempts).set({ createdAt: order.createdAt }).where(eq(paymentAttempts.orderId, order.id))
    await db().insert(reconcileCheckpoints).values({ integrationId: setup.integration.id, coveredFrom: new Date(now.getTime() - 24 * 3_600_000), lastSyncedAt: new Date(now.getTime() - 120_000) })
    expect(await cancelOrderIfStillUnpaid(db(), { ...ctx(), id: order.id }, now)).toBe(false)
  })
  it('does not cancel an old order after QR replacement created a fresh attempt', async () => {
    const now = new Date()
    const { order } = await createAwaitingOrder(setup, { createdAt: new Date(now.getTime() - 48 * 3_600_000), expiresAt: new Date(now.getTime() - 60_000) })
    await createReplacementAttempt(db(), { ...ctx(), orderId: order.id })
    expect(await cancelOrderIfStillUnpaid(db(), { ...ctx(), id: order.id }, now)).toBe(false)
  })
  it('keeps a second cancelled-order transfer refundable after resolving the first', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    const one = await receive(attempt.paymentCode)
    await receive(attempt.paymentCode)
    await resolveTransaction(db(), ctx(), { transactionId: one, resolution: 'REFUNDED_OUTSIDE' })
    expect((await row(order.id)).paymentStatus).toBe('REFUND_DUE')
    await expect(markOrderRefunded(db(), ctx(), { orderId: order.id, expectedHeldVnd: 110_000, note: 'stale amount' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    await markOrderRefunded(db(), ctx(), { orderId: order.id, expectedHeldVnd: 55_000, note: 'remaining transfer' })
    expect((await row(order.id)).paymentStatus).toBe('REFUNDED')
    await receive(attempt.paymentCode)
    expect((await row(order.id)).paymentStatus).toBe('REFUND_DUE')
  })
  it('preserves prior REFUNDED status when a later duplicate report is dismissed', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    await receive(attempt.paymentCode)
    await markOrderRefunded(db(), ctx(), { orderId: order.id, expectedHeldVnd: 55_000, note: 'refunded' })
    const duplicate = await receive(attempt.paymentCode)
    await resolveTransaction(db(), ctx(), { transactionId: duplicate, resolution: 'DUPLICATE' })
    expect((await row(order.id)).paymentStatus).toBe('REFUNDED')
  })
  it('rejects a stale bulk refund amount when another transfer arrived', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    await receive(attempt.paymentCode)
    await receive(attempt.paymentCode)
    await expect(markOrderRefunded(db(), ctx(), { orderId: order.id, expectedHeldVnd: 55_000, note: 'Only saw one' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    expect((await db().select().from(bankTransactions)).filter(t => t.reconciliationStatus === 'REVIEW_REQUIRED')).toHaveLength(2)
  })
  it('only one simultaneous job owns the lease', async () => {
    let release!: () => void
    let entered!: () => void
    const inside = new Promise<void>(resolve => { entered = resolve })
    const barrier = new Promise<void>(resolve => { release = resolve })
    const first = withPaymentJobLease(db(), 'test-job', async () => { entered(); await barrier; return 1 })
    await inside
    expect(await withPaymentJobLease(db(), 'test-job', async () => 2)).toBeNull()
    release()
    expect(await first).toBe(1)
    expect(await withPaymentJobLease(db(), 'test-job', async () => 3)).toBe(3)
  })
})
