import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orderPayments, orders, paymentAttempts, reconcileCheckpoints } from '../../server/db/schema'
import { cancelOrderIfStillUnpaid, expirePaymentAttempts } from '../../server/services/payments/expire-payment-attempts'
import { matchTransaction } from '../../server/services/payments/match-transaction'
import { recordBankTransaction } from '../../server/services/payments/record-bank-transaction'
import { createTenant } from '../support/fixtures'
import { bankTxInput, createAwaitingOrder, createPaymentSetup, type PaymentSetup } from '../support/webhook-fixtures'
import { resetDb } from '../support/db'

const db = () => getDb()
const NOW = new Date('2026-11-01T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

let setup: PaymentSetup

async function setCheckpoint(integrationId: string, lastSyncedAt: Date | null) {
  await db().insert(reconcileCheckpoints).values({ integrationId, lastSyncedAt, coveredFrom: hoursAgo(48) })
}

async function orderRow(id: string) {
  return (await db().select().from(orders).where(eq(orders.id, id)))[0]!
}

async function oldOrder(opts: Parameters<typeof createAwaitingOrder>[1] = {}) {
  return createAwaitingOrder(setup, { createdAt: hoursAgo(30), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(29), ...opts })
}

beforeEach(async () => {
  await resetDb()
  setup = await createPaymentSetup(await createTenant('a'), { apiToken: 'sepay-token' })
})
afterAll(async () => {
  await closeDb()
})

describe('expiring attempts', () => {
  it('expires only PENDING attempts whose time has passed and leaves the order alone', async () => {
    const past = await createAwaitingOrder(setup, { expiresAt: hoursAgo(1) })
    const future = await createAwaitingOrder(setup, { expiresAt: new Date(NOW.getTime() + 600_000) })
    const result = await expirePaymentAttempts(db(), NOW)
    expect(result.expiredAttempts).toBe(1)
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, past.attempt.id)))[0]!.status).toBe('EXPIRED')
    expect((await db().select().from(paymentAttempts).where(eq(paymentAttempts.id, future.attempt.id)))[0]!.status).toBe('PENDING')
    expect(await orderRow(past.order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('is idempotent', async () => {
    await createAwaitingOrder(setup, { expiresAt: hoursAgo(1) })
    await expirePaymentAttempts(db(), NOW)
    expect(await expirePaymentAttempts(db(), NOW)).toEqual({ expiredAttempts: 0, cancelledOrders: 0 })
  })
})

describe('auto-cancel after 24 h needs a reconcile that ran after the last expiry', () => {
  it('cancels when the checkpoint is later than the last attempt expiry', async () => {
    const { order } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(0.1))
    expect(await expirePaymentAttempts(db(), NOW)).toMatchObject({ cancelledOrders: 1 })
    expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
    const events = await db().select().from(orderEvents).where(eq(orderEvents.orderId, order.id))
    expect(events.find(e => e.eventType === 'AUTO_CANCELLED_UNPAID')).toMatchObject({ fromState: 'AWAITING_PAYMENT', toState: 'CANCELLED', actorUserId: null })
  })

  it.each([
    ['no reconcile has ever run', async () => {}],
    ['the last reconcile finished before the attempt expired', async () => setCheckpoint(setup.integration.id, hoursAgo(31))],
    ['the checkpoint row exists but never synced', async () => setCheckpoint(setup.integration.id, null)],
  ])('does not cancel when %s', async (_name, arrange) => {
    const { order } = await oldOrder()
    await arrange()
    expect(await expirePaymentAttempts(db(), NOW)).toMatchObject({ cancelledOrders: 0 })
    expect(await orderRow(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' })
  })

  it('never cancels automatically when the integration has no API token (manual reconciliation only)', async () => {
    const noApi = await createPaymentSetup(await createTenant('b'))
    const { order } = await createAwaitingOrder(noApi, { createdAt: hoursAgo(30), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(29) })
    await setCheckpoint(noApi.integration.id, hoursAgo(0.1))
    await expirePaymentAttempts(db(), NOW)
    expect(await orderRow(order.id)).toMatchObject({ status: 'AWAITING_PAYMENT' })
  })

  it('does not cancel orders younger than 24 h, orders under review, or orders with a live attempt', async () => {
    await setCheckpoint(setup.integration.id, hoursAgo(0.1))
    const young = await createAwaitingOrder(setup, { createdAt: hoursAgo(5), attemptStatus: 'EXPIRED', expiresAt: hoursAgo(4) })
    const review = await oldOrder({ paymentStatus: 'REVIEW_REQUIRED' })
    const live = await createAwaitingOrder(setup, { createdAt: hoursAgo(30), expiresAt: new Date(NOW.getTime() + 600_000) })
    await expirePaymentAttempts(db(), NOW)
    for (const id of [young.order.id, review.order.id, live.order.id]) expect((await orderRow(id)).status).toBe('AWAITING_PAYMENT')
  })

  it('does not cancel while a RECEIVED transaction carrying the order code is still waiting to be matched', async () => {
    const { order, attempt } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(0.1))
    await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await expirePaymentAttempts(db(), NOW)
    expect((await orderRow(order.id)).status).toBe('AWAITING_PAYMENT')
  })
})

describe('late money after an automatic cancel (Review Focus #3)', () => {
  it('is never lost: the order becomes REFUND_DUE and the transfer waits in review', async () => {
    const { order, attempt } = await oldOrder()
    await setCheckpoint(setup.integration.id, hoursAgo(0.1))
    await expirePaymentAttempts(db(), NOW)

    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    expect(await matchTransaction(db(), received.id)).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
    expect(await orderRow(order.id)).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
  })

  it('cancel never overrides a payment that committed first', async () => {
    const { order, attempt } = await oldOrder()
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    await matchTransaction(db(), received.id)
    expect(await cancelOrderIfStillUnpaid(db(), { id: order.id, orgId: setup.orgId, storeId: setup.storeId }, NOW)).toBe(false)
    expect(await orderRow(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
  })

  it('cancel racing with a match keeps the invariant: paid once, or cancelled with the money in review', async () => {
    const { order, attempt } = await oldOrder()
    const received = await recordBankTransaction(db(), bankTxInput(setup, { paymentCode: attempt.paymentCode }))
    const target = { id: order.id, orgId: setup.orgId, storeId: setup.storeId }

    const [cancelled, outcome] = await Promise.all([cancelOrderIfStillUnpaid(db(), target, NOW), matchTransaction(db(), received.id)])

    const payments = await db().select().from(orderPayments).where(eq(orderPayments.orderId, order.id))
    const final = await orderRow(order.id)
    if (cancelled) {
      expect(payments).toHaveLength(0)
      expect(outcome).toEqual({ kind: 'REVIEW', reason: 'ORDER_CANCELLED', orderId: order.id })
      expect(final).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    }
    else {
      expect(outcome).toMatchObject({ kind: 'MATCHED' })
      expect(payments).toHaveLength(1)
      expect(final).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    }
  })
})
