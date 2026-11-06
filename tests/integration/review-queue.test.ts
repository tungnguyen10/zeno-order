import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactionEvents, bankTransactions, orderPayments, orders, paymentAttempts } from '../../server/db/schema'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { assignTransactionToOrder, listReviewItems, resolveTransaction } from '../../server/services/payments/review-queue'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let tenant: Awaited<ReturnType<typeof createTenant>>
let setup: PaymentSetup
let ctx: { orgId: string, userId: string }

async function review(overrides: Parameters<typeof bankTxInput>[1] = {}) {
  const { id } = await recordBankTransaction(db(), bankTxInput(setup, overrides))
  await matchTransaction(db(), id)
  return id
}
const txRow = async (id: string) => (await db().select().from(bankTransactions).where(eq(bankTransactions.id, id)))[0]!
const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  setup = await createPaymentSetup(tenant)
  ctx = { orgId: setup.orgId, userId: tenant.owner.userId }
})
afterAll(async () => {
  await closeDb()
})

describe('listReviewItems', () => {
  it('lists REVIEW_REQUIRED items with a one-tap suggestion for an exact-amount unpaid order', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const other = await createAwaitingOrder(setup, { amountVnd: 99_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000, content: 'ck tra sua' })

    const items = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      id: txId, status: 'REVIEW_REQUIRED', reason: 'NO_CODE', amountVnd: 70_000, content: 'ck tra sua',
      accountLast4: setup.account.accountNumber.slice(-4),
    })
    expect(items[0]!.suggestedOrders.map(o => o.id)).toEqual([order.id])
    expect(items[0]!.suggestedOrders.map(o => o.id)).not.toContain(other.order.id)
  })

  it('suggests the matched order first when the amount was wrong, and exposes it as matchedOrder', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    await review({ paymentCode: attempt.paymentCode, amountVnd: 50_000 })
    const [item] = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(item).toMatchObject({ reason: 'AMOUNT_UNDER', matchedOrder: { id: order.id, publicCode: order.publicCode } })
    expect(item!.suggestedOrders[0]!.id).toBe(order.id)
  })

  it('never shows another organisation\'s transactions or orders', async () => {
    const other = await createPaymentSetup(await createTenant('b'))
    await createAwaitingOrder(other, { amountVnd: 70_000 })
    const { id } = await recordBankTransaction(db(), bankTxInput(other, { amountVnd: 70_000 }))
    await matchTransaction(db(), id)
    await review({ paymentCode: null, amountVnd: 70_000 })
    const items = await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')
    expect(items).toHaveLength(1)
    expect(items[0]!.suggestedOrders).toHaveLength(0)
  })

  it('does not list matched or ignored transactions; resolved ones appear under RESOLVED', async () => {
    const { attempt } = await createAwaitingOrder(setup)
    const matched = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), matched.id)
    await recordBankTransaction(db(), bankTxInput(setup, { direction: 'OUT' }))
    const resolvedId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: resolvedId, resolution: 'NOT_ORDER' })
    expect(await listReviewItems(db(), ctx, 'REVIEW_REQUIRED')).toHaveLength(0)
    expect((await listReviewItems(db(), ctx, 'RESOLVED')).map(i => i.id)).toEqual([resolvedId])
  })
})

describe('assignTransactionToOrder', () => {
  it('assigns an exact-amount transfer in one call: order NEW/PAID, one SEPAY payment by the owner, tx MATCHED', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    expect(await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: false })).toEqual({ orderId: order.id })

    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID', latePayment: true })
    const payments = await paymentsOf(order.id)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ method: 'SEPAY', bankTransactionId: txId, amountVnd: 70_000, recordedBy: ctx.userId })
    expect(await txRow(txId)).toMatchObject({ reconciliationStatus: 'MATCHED', matchedOrderId: order.id, resolvedBy: ctx.userId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, txId))
    expect(events.map(e => e.action)).toContain('ASSIGNED')
  })

  it('refuses a different amount until the owner accepts the difference, then records the real amount', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await review({ paymentCode: null, amountVnd: 60_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'AMOUNT_MISMATCH', expectedVnd: 55_000, receivedVnd: 60_000 } })
    expect((await orderRow(order.id)).paymentStatus).toBe('PENDING')

    await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: true })
    expect((await paymentsOf(order.id))[0]!.amountVnd).toBe(60_000)
  })

  it('releases the review flag on the order the transfer was first matched to', async () => {
    const wrong = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const target = await createAwaitingOrder(setup, { amountVnd: 50_000 })
    const txId = await review({ paymentCode: wrong.attempt.paymentCode, amountVnd: 50_000 })
    expect((await orderRow(wrong.order.id)).paymentStatus).toBe('REVIEW_REQUIRED')

    await assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: target.order.id, acceptAmountDifference: false })
    expect((await orderRow(wrong.order.id)).paymentStatus).toBe('PENDING')
    expect((await orderRow(target.order.id)).paymentStatus).toBe('PAID')
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, wrong.attempt.id)))[0]!.status).toBe('PENDING')
  })

  it('double tap: the second call gets STATUS_CONFLICT and nothing is credited twice (Review Focus #5)', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    const input = { transactionId: txId, orderId: order.id, acceptAmountDifference: false }
    const results = await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, input),
      assignTransactionToOrder(db(), ctx, input),
      assignTransactionToOrder(db(), ctx, input),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results.filter(r => r.status === 'rejected')) expect((r as PromiseRejectedResult).reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('two transfers racing for one order: one wins, the other gets STATUS_CONFLICT and stays in review', async () => {
    const { order } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const a = await review({ paymentCode: null, amountVnd: 70_000 })
    const b = await review({ paymentCode: null, amountVnd: 70_000 })
    const results = await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, { transactionId: a, orderId: order.id, acceptAmountDifference: false }),
      assignTransactionToOrder(db(), ctx, { transactionId: b, orderId: order.id, acceptAmountDifference: false }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
    const stillReview = [await txRow(a), await txRow(b)].filter(t => t.reconciliationStatus === 'REVIEW_REQUIRED')
    expect(stillReview).toHaveLength(1)
  })

  it('assign racing with the webhook matcher on the same order never double-pays', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 70_000 })
    const manual = await review({ paymentCode: null, amountVnd: 70_000 })
    const incoming = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode, amountVnd: 70_000 }))
    await Promise.allSettled([
      assignTransactionToOrder(db(), ctx, { transactionId: manual, orderId: order.id, acceptAmountDifference: false }),
      matchTransaction(db(), incoming.id),
    ])
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('returns 404 for an order or transaction outside the organisation and never touches them', async () => {
    const otherSetup = await createPaymentSetup(await createTenant('b'))
    const foreign = await createAwaitingOrder(otherSetup, { amountVnd: 70_000 })
    const txId = await review({ paymentCode: null, amountVnd: 70_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: foreign.order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await orderRow(foreign.order.id)).paymentStatus).toBe('PENDING')

    const foreignTx = await recordBankTransaction(db(), bankTxInput(otherSetup))
    await matchTransaction(db(), foreignTx.id)
    const { order } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: foreignTx.id, orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: 'nope', orderId: order.id, acceptAmountDifference: false }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('refuses an order that is no longer waiting for payment', async () => {
    const { order } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    const txId = await review({ paymentCode: null })
    await expect(assignTransactionToOrder(db(), ctx, { transactionId: txId, orderId: order.id, acceptAmountDifference: true }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })
})

describe('resolveTransaction', () => {
  it('marks the transfer RESOLVED with who/when/why and an audit event', async () => {
    const txId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'OTHER', note: 'Khách chuyển nhầm, đã trả lại' })
    expect(await txRow(txId)).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'OTHER', resolutionNote: 'Khách chuyển nhầm, đã trả lại', resolvedBy: ctx.userId })
    const events = await db().select().from(bankTransactionEvents).where(eq(bankTransactionEvents.bankTransactionId, txId))
    expect(events.map(e => e.action)).toContain('RESOLVED')
  })

  it('a second resolve (double tap) gets STATUS_CONFLICT', async () => {
    const txId = await review({ paymentCode: null })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })
    await expect(resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('REFUNDED_OUTSIDE on money for a cancelled order closes the refund too (REFUND_DUE → REFUNDED)', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: attempt.paymentCode })
    expect((await orderRow(order.id)).paymentStatus).toBe('REFUND_DUE')
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('REFUNDED')
  })

  it('any other resolution for a cancelled, never-paid order returns it to UNPAID', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const txId = await review({ paymentCode: attempt.paymentCode })
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'NOT_ORDER' })
    expect((await orderRow(order.id)).paymentStatus).toBe('UNPAID')
  })

  it('a duplicate transfer on a PAID order is resolved without touching the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    const first = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), first.id)
    const dupId = await review({ paymentCode: attempt.paymentCode })
    await resolveTransaction(db(), ctx, { transactionId: dupId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('PAID')
  })

  it('returns an order flagged by an under-payment to PENDING once its last review item is resolved', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const txId = await review({ paymentCode: attempt.paymentCode, amountVnd: 40_000 })
    expect((await orderRow(order.id)).paymentStatus).toBe('REVIEW_REQUIRED')
    await resolveTransaction(db(), ctx, { transactionId: txId, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('PENDING')
  })

  it('keeps REVIEW_REQUIRED while another review item still points at the order', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 55_000 })
    const one = await review({ paymentCode: attempt.paymentCode, amountVnd: 40_000 })
    await review({ paymentCode: attempt.paymentCode, amountVnd: 41_000 })
    await resolveTransaction(db(), ctx, { transactionId: one, resolution: 'REFUNDED_OUTSIDE' })
    expect((await orderRow(order.id)).paymentStatus).toBe('REVIEW_REQUIRED')
  })

  it('cannot resolve another organisation\'s transaction', async () => {
    const otherSetup = await createPaymentSetup(await createTenant('b'))
    const foreign = await recordBankTransaction(db(), bankTxInput(otherSetup))
    await matchTransaction(db(), foreign.id)
    await expect(resolveTransaction(db(), ctx, { transactionId: foreign.id, resolution: 'NOT_ORDER' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await txRow(foreign.id)).reconciliationStatus).toBe('REVIEW_REQUIRED')
  })
})
