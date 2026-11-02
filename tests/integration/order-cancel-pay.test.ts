import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orderPayments, orders } from '../../server/db/schema'
import { cancelOrder } from '../../server/services/ordering/cancel-order'
import { recordCashPayment } from '../../server/services/ordering/record-cash-payment'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderRow, createPaymentRow } from '../support/order-fixtures'

type Tenant = Awaited<ReturnType<typeof createTenant>>
const ctxOf = (tenant: Tenant, role: 'OWNER' | 'STAFF' = 'OWNER', userId = tenant.owner.userId): StoreContext => ({
  orgId: tenant.org.id, storeId: tenant.store.id, role, userId,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

const rowOf = async (id: string) => (await getDb().select().from(orders).where(eq(orders.id, id)))[0]!
const paymentsOf = (id: string) => getDb().select().from(orderPayments).where(eq(orderPayments.orderId, id))
const eventsOf = (id: string) => getDb().select().from(orderEvents).where(eq(orderEvents.orderId, id))

describe('cancelOrder', () => {
  it('lets staff cancel an unpaid order and records the reason', async () => {
    const a = await createTenant('c1')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    const result = await cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'PREPARING', reason: 'Hết nguyên liệu' })
    expect(result).toMatchObject({ status: 'CANCELLED', paymentStatus: 'UNPAID' })
    const [event] = await eventsOf(order.id)
    expect(event).toMatchObject({ eventType: 'CANCELLED', fromState: 'PREPARING', toState: 'CANCELLED', actorUserId: staff.userId })
    expect(event!.metadata).toMatchObject({ reason: 'Hết nguyên liệu' })
  })

  it('forbids staff from cancelling a paid order, but the owner can and it becomes REFUND_DUE', async () => {
    const a = await createTenant('c2')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { paymentStatus: 'PAID' })
    await createPaymentRow(order)

    await expect(cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách đổi ý' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(await rowOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await eventsOf(order.id)).toHaveLength(0)

    const result = await cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách đổi ý' })
    expect(result).toMatchObject({ status: 'CANCELLED', paymentStatus: 'REFUND_DUE' })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it.each(['READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const)('rejects cancelling a %s order, even for the owner', async (status) => {
    const a = await createTenant(`c3-${status.toLowerCase()}`)
    const order = await createOrderRow(a.store, { status, fulfillmentType: 'DELIVERY' })
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: status, reason: 'Thử hủy' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'TRANSITION_NOT_ALLOWED' } })
    expect((await rowOf(order.id)).status).toBe(status)
  })

  it('cancels an AWAITING_PAYMENT order for staff (payment PENDING)', async () => {
    const a = await createTenant('c4')
    const order = await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const staff = await addStaff(a.store)
    expect(await cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'AWAITING_PAYMENT', reason: 'Khách không chuyển khoản' }))
      .toMatchObject({ status: 'CANCELLED', paymentStatus: 'PENDING' })
  })

  it('returns STATUS_CONFLICT when the status moved on', async () => {
    const a = await createTenant('c5')
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', reason: 'Lý do' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } })
  })

  it('does not leak other stores (NOT_FOUND)', async () => {
    const a = await createTenant('c6a')
    const b = await createTenant('c6b')
    const orderOfB = await createOrderRow(b.store)
    await expect(cancelOrder(getDb(), ctxOf(a), { orderId: orderOfB.id, expectedStatus: 'NEW', reason: 'Lý do' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect((await rowOf(orderOfB.id)).status).toBe('NEW')
  })
})

describe('recordCashPayment', () => {
  it('records exactly one CASH payment equal to the order total', async () => {
    const a = await createTenant('p1')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { totalVnd: 73_000, subtotalVnd: 73_000 })
    const result = await recordCashPayment(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedPaymentStatus: 'UNPAID', note: 'Khách đưa 100k, thối 27k' })
    expect(result).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    const [payment] = await paymentsOf(order.id)
    expect(payment).toMatchObject({ method: 'CASH', amountVnd: 73_000, recordedBy: staff.userId, note: 'Khách đưa 100k, thối 27k', bankTransactionId: null })
    const [event] = await eventsOf(order.id)
    expect(event).toMatchObject({ eventType: 'PAYMENT_RECORDED', actorUserId: staff.userId })
    expect(event!.metadata).toMatchObject({ method: 'CASH', amountVnd: 73_000 })
  })

  it('works on a COMPLETED COD order (paid on delivery)', async () => {
    const a = await createTenant('p2')
    const order = await createOrderRow(a.store, { status: 'COMPLETED' })
    expect(await recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })).toMatchObject({ paymentStatus: 'PAID' })
  })

  it('second tap is STATUS_CONFLICT and still one payment', async () => {
    const a = await createTenant('p3')
    const order = await createOrderRow(a.store)
    await recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentPaymentStatus: 'PAID' } })
    expect(await paymentsOf(order.id)).toHaveLength(1)
  })

  it('five simultaneous taps create one payment', async () => {
    const a = await createTenant('p4')
    const order = await createOrderRow(a.store)
    const tap = () => recordCashPayment(getDb(), ctxOf(a), { orderId: order.id, expectedPaymentStatus: 'UNPAID' })
    const results = await Promise.allSettled([tap(), tap(), tap(), tap(), tap()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await paymentsOf(order.id)).toHaveLength(1)
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('refuses cancelled orders and non-COD orders', async () => {
    const a = await createTenant('p5')
    const cancelled = await createOrderRow(a.store, { status: 'CANCELLED' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: cancelled.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT' })
    const bank = await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: bank.id, expectedPaymentStatus: 'PENDING' }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'NOT_COD' } })
    expect(await paymentsOf(cancelled.id)).toHaveLength(0)
    expect(await paymentsOf(bank.id)).toHaveLength(0)
  })

  it('does not leak other stores (NOT_FOUND)', async () => {
    const a = await createTenant('p6a')
    const b = await createTenant('p6b')
    const orderOfB = await createOrderRow(b.store)
    await expect(recordCashPayment(getDb(), ctxOf(a), { orderId: orderOfB.id, expectedPaymentStatus: 'UNPAID' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('cancel vs mark-paid race (Review Focus #2)', () => {
  it('never ends as cancelled-and-paid without REFUND_DUE, never pays a cancelled order', async () => {
    const a = await createTenant('race')
    const staff = await addStaff(a.store)
    for (let i = 0; i < 8; i++) {
      const order = await createOrderRow(a.store)
      const results = await Promise.allSettled([
        cancelOrder(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách hủy' }),
        recordCashPayment(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedPaymentStatus: 'UNPAID' }),
      ])
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)

      const row = await rowOf(order.id)
      const payments = await paymentsOf(order.id)
      if (row.status === 'CANCELLED') {
        expect(row.paymentStatus).toBe('UNPAID')
        expect(payments).toHaveLength(0)
      }
      else {
        expect(row).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
        expect(payments).toHaveLength(1)
      }
    }
  })
})

describe('cash and cancellation transaction rollback', () => {
  it('rolls back paid status if the cash payment cannot be inserted', async () => {
    const a = await createTenant('payment-rollback')
    const order = await createOrderRow(a.store)
    await expect(recordCashPayment(getDb(), { ...ctxOf(a), userId: 'missing-actor' }, { orderId: order.id, expectedPaymentStatus: 'UNPAID' })).rejects.toBeTruthy()
    expect((await rowOf(order.id)).paymentStatus).toBe('UNPAID')
    expect(await paymentsOf(order.id)).toHaveLength(0)
    expect(await eventsOf(order.id)).toHaveLength(0)
  })

  it('rolls back cancellation and refund status if the event cannot be inserted', async () => {
    const a = await createTenant('cancel-rollback')
    const order = await createOrderRow(a.store, { paymentStatus: 'PAID' })
    await expect(cancelOrder(getDb(), { ...ctxOf(a), userId: 'missing-actor' }, { orderId: order.id, expectedStatus: 'NEW', reason: 'Khách hủy' })).rejects.toBeTruthy()
    expect(await rowOf(order.id)).toMatchObject({ status: 'NEW', paymentStatus: 'PAID' })
    expect(await eventsOf(order.id)).toHaveLength(0)
  })
})
