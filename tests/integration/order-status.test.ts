import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { orderEvents, orders } from '../../server/db/schema'
import { changeOrderStatus } from '../../server/services/ordering/change-status'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderRow } from '../support/order-fixtures'

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

const statusOf = async (id: string) => (await getDb().select().from(orders).where(eq(orders.id, id)))[0]!.status
const eventsOf = (id: string) => getDb().select().from(orderEvents).where(eq(orderEvents.orderId, id))

describe('changeOrderStatus', () => {
  it('moves NEW → PREPARING and records who did it', async () => {
    const a = await createTenant('adv')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store)
    const result = await changeOrderStatus(getDb(), ctxOf(a, 'STAFF', staff.userId), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' })
    expect(result).toMatchObject({ id: order.id, status: 'PREPARING', paymentStatus: 'UNPAID' })
    const events = await eventsOf(order.id)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ eventType: 'STATUS_CHANGED', fromState: 'NEW', toState: 'PREPARING', actorUserId: staff.userId, storeId: a.store.id })
  })

  it.each([
    ['DINE_IN', ['NEW', 'PREPARING', 'READY', 'COMPLETED']],
    ['PICKUP', ['NEW', 'READY', 'COMPLETED']],
    ['DELIVERY', ['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']],
  ] as const)('walks the whole %s path one step at a time', async (fulfillmentType, path) => {
    const a = await createTenant(`walk-${fulfillmentType.toLowerCase()}`)
    const order = await createOrderRow(a.store, { fulfillmentType })
    for (let i = 0; i < path.length - 1; i++) {
      await changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: path[i]!, nextStatus: path[i + 1]! })
    }
    expect(await statusOf(order.id)).toBe('COMPLETED')
    expect(await eventsOf(order.id)).toHaveLength(path.length - 1)
  })

  it.each([
    ['NEW', 'COMPLETED', 'PICKUP'],
    ['NEW', 'CANCELLED', 'PICKUP'],
    ['NEW', 'DELIVERING', 'DELIVERY'],
    ['PREPARING', 'NEW', 'PICKUP'],
    ['READY', 'DELIVERING', 'PICKUP'],
    ['READY', 'COMPLETED', 'DELIVERY'],
    ['COMPLETED', 'READY', 'PICKUP'],
    ['CANCELLED', 'NEW', 'PICKUP'],
    ['AWAITING_PAYMENT', 'NEW', 'PICKUP'],
  ] as const)('rejects %s → %s (%s) without touching the order', async (from, to, fulfillmentType) => {
    const a = await createTenant('illegal')
    const order = await createOrderRow(a.store, {
      status: from,
      fulfillmentType,
      ...(from === 'AWAITING_PAYMENT' ? { paymentMethod: 'BANK_QR' as const, paymentStatus: 'PENDING' as const } : {}),
    })
    await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: from, nextStatus: to }))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED', details: { reason: 'TRANSITION_NOT_ALLOWED' } })
    expect(await statusOf(order.id)).toBe(from)
    expect(await eventsOf(order.id)).toHaveLength(0)
  })

  it('returns STATUS_CONFLICT with the current status when expectedStatus is stale', async () => {
    const a = await createTenant('stale')
    const order = await createOrderRow(a.store, { status: 'PREPARING' })
    await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' }))
      .rejects.toMatchObject({ code: 'STATUS_CONFLICT', details: { currentStatus: 'PREPARING' } })
    expect(await eventsOf(order.id)).toHaveLength(0)
  })

  it('treats another store\'s order and an unknown id as NOT_FOUND', async () => {
    const a = await createTenant('nf-a')
    const b = await createTenant('nf-b')
    const orderOfB = await createOrderRow(b.store)
    for (const orderId of [orderOfB.id, randomUUID()]) {
      await expect(changeOrderStatus(getDb(), ctxOf(a), { orderId, expectedStatus: 'NEW', nextStatus: 'PREPARING' }))
        .rejects.toMatchObject({ code: 'NOT_FOUND' })
    }
    expect(await statusOf(orderOfB.id)).toBe('NEW')
  })
})

describe('changeOrderStatus concurrency (Review Focus #9)', () => {
  it('two staff tapping the same transition: exactly one wins, the other gets STATUS_CONFLICT', async () => {
    const a = await createTenant('race-same')
    const s1 = await addStaff(a.store)
    const s2 = await addStaff(a.store)
    const order = await createOrderRow(a.store)
    const input = { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' } as const

    const results = await Promise.allSettled([
      changeOrderStatus(getDb(), ctxOf(a, 'STAFF', s1.userId), input),
      changeOrderStatus(getDb(), ctxOf(a, 'STAFF', s2.userId), input),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    expect(await statusOf(order.id)).toBe('PREPARING')
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('two staff choosing different targets (PREPARING vs READY): one winner, one event', async () => {
    const a = await createTenant('race-diff')
    const order = await createOrderRow(a.store)
    const results = await Promise.allSettled([
      changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' }),
      changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'READY' }),
    ])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    expect(['PREPARING', 'READY']).toContain(await statusOf(order.id))
    expect(await eventsOf(order.id)).toHaveLength(1)
  })

  it('five simultaneous taps (double tap + retries) still produce one transition', async () => {
    const a = await createTenant('race-five')
    const order = await createOrderRow(a.store)
    const tap = () => changeOrderStatus(getDb(), ctxOf(a), { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' })
    const results = await Promise.allSettled([tap(), tap(), tap(), tap(), tap()])
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'STATUS_CONFLICT' })
    }
    expect(await eventsOf(order.id)).toHaveLength(1)
  })
})

describe('status transaction rollback', () => {
  it('rolls back the transition when its event cannot be inserted', async () => {
    const a = await createTenant('status-rollback')
    const order = await createOrderRow(a.store)
    await expect(changeOrderStatus(getDb(), { ...ctxOf(a), userId: 'missing-actor' }, { orderId: order.id, expectedStatus: 'NEW', nextStatus: 'PREPARING' })).rejects.toBeTruthy()
    expect(await statusOf(order.id)).toBe('NEW')
    expect(await eventsOf(order.id)).toHaveLength(0)
  })
})
