import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '#shared/enums'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { fulfillmentType, orderEvents, orderItems, orders, orderStatus, paymentMethod, paymentStatus, rateLimits } from '../../server/db/schema'
import { resetDb } from '../support/db'
import { insertRawOrder, seedMenu } from '../support/checkout-fixtures'
import { createTenant } from '../support/fixtures'

async function expectPgError(promise: Promise<unknown>, code: string, constraint?: string) {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error, 'expected the statement to fail').not.toBeNull()
  const pg = getPgError(error)
  expect(pg.code).toBe(code)
  if (constraint) expect(pg.constraint).toBe(constraint)
}

const itemValues = (store: { id: string, orgId: string }, orderId: string, over: Partial<typeof orderItems.$inferInsert> = {}) => ({
  orgId: store.orgId,
  storeId: store.id,
  orderId,
  position: 0,
  nameSnapshot: 'Trà sữa',
  qty: 2,
  unitPriceVnd: 25_000,
  lineTotalVnd: 50_000,
  ...over,
})

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

describe('ordering enums stay in sync with shared/enums', () => {
  it('matches the pgEnum values', () => {
    expect(fulfillmentType.enumValues).toEqual([...FULFILLMENT_TYPES])
    expect(orderStatus.enumValues).toEqual([...ORDER_STATUSES])
    expect(paymentMethod.enumValues).toEqual([...PAYMENT_METHODS])
    expect(paymentStatus.enumValues).toEqual([...PAYMENT_STATUSES])
  })
})

describe('orders constraints', () => {
  it('stores a valid order with defaults', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    expect(order).toMatchObject({ latePayment: false, status: 'NEW', paymentStatus: 'UNPAID', tableId: null })
    expect(order.createdAt).toBeInstanceOf(Date)
  })

  it('keeps idempotency keys unique per store but reusable across stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const key = randomUUID()
    await insertRawOrder(a.store, { idempotencyKey: key })
    await insertRawOrder(b.store, { idempotencyKey: key })
    await expectPgError(insertRawOrder(a.store, { idempotencyKey: key }), '23505', 'orders_store_idem_uq')
  })

  it('keeps public codes unique per store but reusable across stores', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await insertRawOrder(a.store, { publicCode: 'AB23CD' })
    await insertRawOrder(b.store, { publicCode: 'AB23CD' })
    await expectPgError(insertRawOrder(a.store, { publicCode: 'AB23CD' }), '23505', 'orders_store_public_code_uq')
  })

  it('keeps guest token hashes globally unique', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await insertRawOrder(a.store, { guestTokenHash: 'same-hash' })
    await expectPgError(insertRawOrder(b.store, { guestTokenHash: 'same-hash' }), '23505', 'orders_guest_token_hash_uq')
  })

  it('rejects an org that does not own the store (composite FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    await expectPgError(insertRawOrder({ id: a.store.id, orgId: b.org.id }), '23503', 'orders_store_fk')
  })

  it('rejects a table or zone that belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const menuA = await seedMenu(a.store)
    await expectPgError(
      insertRawOrder(b.store, { fulfillmentType: 'DINE_IN', tableId: menuA.table.id }),
      '23503',
      'orders_table_fk',
    )
    await expectPgError(
      insertRawOrder(b.store, { fulfillmentType: 'DELIVERY', deliveryZoneId: menuA.zone.id, addressSnapshot: '1 A' }),
      '23503',
      'orders_zone_fk',
    )
  })

  it('rejects totals that do not add up or are negative (23514)', async () => {
    const a = await createTenant('a')
    await expectPgError(insertRawOrder(a.store, { subtotalVnd: 50_000, deliveryFeeVnd: 15_000, totalVnd: 50_000 }), '23514', 'orders_money_check')
    await expectPgError(insertRawOrder(a.store, { subtotalVnd: -1, deliveryFeeVnd: 0, totalVnd: -1 }), '23514', 'orders_money_check')
  })
})

describe('order_items and order_events constraints', () => {
  it('rejects an item whose order belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderA = await insertRawOrder(a.store)
    await expectPgError(getDb().insert(orderItems).values(itemValues(b.store, orderA.id)), '23503', 'order_items_order_fk')
  })

  it('rejects an item whose product belongs to another store', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const menuB = await seedMenu(b.store)
    const orderA = await insertRawOrder(a.store)
    await expectPgError(
      getDb().insert(orderItems).values(itemValues(a.store, orderA.id, { productId: menuB.tea.id })),
      '23503',
      'order_items_product_fk',
    )
  })

  it('rejects quantity outside 1..50 and line totals that do not match (23514)', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { qty: 0, lineTotalVnd: 0 })), '23514', 'order_items_qty_check')
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { qty: 51, lineTotalVnd: 51 * 25_000 })), '23514', 'order_items_qty_check')
    await expectPgError(getDb().insert(orderItems).values(itemValues(a.store, order.id, { lineTotalVnd: 49_999 })), '23514', 'order_items_money_check')
  })

  it('stores the option snapshot as JSON and cascades items and events with the order', async () => {
    const a = await createTenant('a')
    const order = await insertRawOrder(a.store)
    const snapshot = [{ groupId: 'g', groupName: 'Size', valueId: 'v', valueName: 'L', priceDeltaVnd: 7_000 }]
    await getDb().insert(orderItems).values(itemValues(a.store, order.id, { optionsSnapshotJson: snapshot }))
    await getDb().insert(orderEvents).values({ orgId: a.org.id, storeId: a.store.id, orderId: order.id, eventType: 'CREATED', toState: 'NEW' })

    const [item] = await getDb().select().from(orderItems)
    expect(item!.optionsSnapshotJson).toEqual(snapshot)
    const [event] = await getDb().select().from(orderEvents)
    expect(event).toMatchObject({ eventType: 'CREATED', fromState: null, toState: 'NEW', actorUserId: null, metadata: {} })

    await getDb().delete(orders)
    expect(await getDb().select().from(orderItems)).toEqual([])
    expect(await getDb().select().from(orderEvents)).toEqual([])
  })
})

describe('rate_limits', () => {
  it('has a composite primary key on (key, window_start)', async () => {
    const windowStart = new Date('2026-10-31T10:00:00Z')
    await getDb().insert(rateLimits).values({ key: 'k', windowStart, count: 1 })
    await expectPgError(getDb().insert(rateLimits).values({ key: 'k', windowStart, count: 1 }), '23505', 'rate_limits_pk')
    await getDb().insert(rateLimits).values({ key: 'k', windowStart: new Date('2026-10-31T10:10:00Z'), count: 1 })
  })
})
