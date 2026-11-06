import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { bankTransactions, orderEvents, orderPayments, orders, paymentAttempts } from '../../server/db/schema'
import {
  getReconciliationSummary, listOverdueOrders, listRefundDueOrders, markOrderPaidBankManual, markOrderRefunded,
} from '../../server/services/payments/manual-payments'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createStore, createTenant } from '../support/fixtures'
import { bankTxInput, createAttempt, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()

let tenant: Awaited<ReturnType<typeof createTenant>>
let setup: PaymentSetup
let ctx: { orgId: string, storeId: string, userId: string }

const orderRow = async (id: string) => (await db().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (orderId: string) => db().select().from(orderPayments).where(eq(orderPayments.orderId, orderId))

async function refundDueOrder(amountVnd = 55_000) {
  const made = await createAwaitingOrder(setup, { amountVnd, orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE', attemptStatus: 'EXPIRED' })
  await db().insert(orderPayments).values({
    orgId: setup.orgId, storeId: setup.storeId, orderId: made.order.id, method: 'SEPAY', amountVnd,
  })
  return made
}

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  setup = await createPaymentSetup(tenant)
  ctx = { orgId: setup.orgId, storeId: setup.storeId, userId: tenant.owner.userId }
})
afterAll(async () => {
  await closeDb()
})

describe('listRefundDueOrders / markOrderRefunded', () => {
  it('lists REFUND_DUE orders of the store with the amount held', async () => {
    const paid = await refundDueOrder(55_000)
    const lateTx = await createAwaitingOrder(setup, { amountVnd: 40_000, orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: lateTx.attempt.paymentCode, amountVnd: 40_000 }))
    await matchTransaction(db(), received.id)

    const items = await listRefundDueOrders(db(), ctx)
    expect(items.map(i => [i.id, i.heldVnd]).sort()).toEqual([[paid.order.id, 55_000], [lateTx.order.id, 40_000]].sort())
  })

  it('does not list orders of another store in the same organisation', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    await createAwaitingOrder(otherSetup, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(await listRefundDueOrders(db(), ctx)).toHaveLength(0)
  })

  it('marks the order REFUNDED with an audit event carrying the note, and resolves the linked review item', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { orderStatus: 'CANCELLED', paymentStatus: 'UNPAID', attemptStatus: 'EXPIRED' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), received.id)

    await markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: order.id, note: 'Đã chuyển khoản hoàn lại 10:30' })

    expect((await orderRow(order.id)).paymentStatus).toBe('REFUNDED')
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'PAYMENT_REFUNDED')).toMatchObject({ actorUserId: ctx.userId, metadata: { note: 'Đã chuyển khoản hoàn lại 10:30' } })
    const [tx] = await db().select().from(bankTransactions).where(eq(bankTransactions.id, received.id))
    expect(tx).toMatchObject({ reconciliationStatus: 'RESOLVED', resolution: 'REFUNDED_OUTSIDE' })
  })

  it('refuses an order that is not REFUND_DUE and a double tap gets STATUS_CONFLICT', async () => {
    const { order } = await refundDueOrder()
    const results = await Promise.allSettled([
      markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: order.id, note: 'Đã hoàn tiền' }),
      markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: order.id, note: 'Đã hoàn tiền' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason).toMatchObject({ code: 'STATUS_CONFLICT' })

    const paid = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'PAID' })
    await expect(markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: paid.order.id, note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
  })

  it('returns 404 for unknown ids and for orders of another store', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    const foreign = await createAwaitingOrder(otherSetup, { orderStatus: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    await expect(markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: foreign.order.id, note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(markOrderRefunded(db(), ctx, { expectedHeldVnd: 55_000, orderId: 'nope', note: 'Đã hoàn tiền' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await orderRow(foreign.order.id)).paymentStatus).toBe('REFUND_DUE')
  })
})

describe('listOverdueOrders', () => {
  it('lists unpaid orders whose every attempt has ended, not those with a live QR', async () => {
    const overdue = await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    await createAwaitingOrder(setup, { attemptStatus: 'PENDING' })
    await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED', orderStatus: 'CANCELLED', paymentStatus: 'UNPAID' })
    const items = await listOverdueOrders(db(), ctx)
    expect(items.map(i => i.id)).toEqual([overdue.order.id])
    expect(items[0]).toMatchObject({ publicCode: overdue.order.publicCode, totalVnd: 55_000, paymentStatus: 'PENDING' })
  })
})

describe('markOrderPaidBankManual', () => {
  it('confirms the order with a BANK_MANUAL payment, audits the note and supersedes live attempts', async () => {
    const { order, attempt } = await createAwaitingOrder(setup, { amountVnd: 70_000, attemptStatus: 'EXPIRED' })
    await createAttempt(setup, order.id, { amountVnd: 70_000, paymentCode: 'ZOLIVE0001', status: 'PENDING' })
    await markOrderPaidBankManual(db(), ctx, { orderId: order.id, expectedPaymentStatus: 'PENDING', note: 'Thấy tiền trong app VCB' })

    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    const payments = await paymentsOf(order.id)
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ method: 'BANK_MANUAL', bankTransactionId: null, amountVnd: 70_000, recordedBy: ctx.userId, note: 'Thấy tiền trong app VCB' })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'PAYMENT_MANUAL_BANK')).toMatchObject({ metadata: { note: 'Thấy tiền trong app VCB' } })
    const attempts = await db().select().from(paymentAttempts).where(eq(paymentAttempts.orderId, order.id))
    expect(attempts.find(a => a.paymentCode === 'ZOLIVE0001')!.status).toBe('SUPERSEDED')
    expect(attempts.find(a => a.id === attempt.id)!.status).toBe('EXPIRED')
  })

  it('a stale expectation or an already paid order gets STATUS_CONFLICT and nothing is recorded', async () => {
    const reviewing = await createAwaitingOrder(setup, { paymentStatus: 'REVIEW_REQUIRED' })
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: reviewing.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    const paid = await createAwaitingOrder(setup, { orderStatus: 'NEW', paymentStatus: 'PAID' })
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: paid.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await paymentsOf(reviewing.order.id)).toHaveLength(0)
  })

  it('two concurrent confirmations record one payment', async () => {
    const { order } = await createAwaitingOrder(setup)
    const input = { orderId: order.id, expectedPaymentStatus: 'PENDING' as const, note: 'Đã thấy tiền' }
    const results = await Promise.allSettled([markOrderPaidBankManual(db(), ctx, input), markOrderPaidBankManual(db(), ctx, input)])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('a webhook for the same order afterwards is kept as a duplicate for review, never a second payment', async () => {
    const { order, attempt } = await createAwaitingOrder(setup)
    await markOrderPaidBankManual(db(), ctx, { orderId: order.id, expectedPaymentStatus: 'PENDING', note: 'Đã thấy tiền' })
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect(await matchTransaction(db(), received.id)).toEqual({ kind: 'REVIEW', reason: 'ORDER_ALREADY_PAID', orderId: order.id })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('404 for another store\'s order', async () => {
    const other = await createStore(setup.orgId, 'a2')
    const otherSetup = await createPaymentSetup({ org: { id: setup.orgId }, store: { id: other.id, orgId: setup.orgId } }, { reuse: setup })
    const foreign = await createAwaitingOrder(otherSetup)
    await expect(markOrderPaidBankManual(db(), ctx, { orderId: foreign.order.id, expectedPaymentStatus: 'PENDING', note: 'abc' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('getReconciliationSummary', () => {
  it('counts review items (org-wide), refunds and overdue orders (store)', async () => {
    const rx = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: null }))
    await matchTransaction(db(), rx.id)
    await refundDueOrder()
    await createAwaitingOrder(setup, { attemptStatus: 'EXPIRED' })
    expect(await getReconciliationSummary(db(), ctx)).toEqual({ reviewCount: 1, refundDueCount: 1, overdueCount: 1 })
  })
})
