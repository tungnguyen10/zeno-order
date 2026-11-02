import { randomUUID } from 'node:crypto'
import { count, eq } from 'drizzle-orm'
import type { PgTable } from 'drizzle-orm/pg-core'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkoutInputSchema, type CheckoutBody } from '#shared/schemas/checkout'
import { closeDb, getDb } from '../../server/db/client'
import { deliveryZones, orderEvents, orderItems, orders, productOptionValues, products, rateLimits, storeTables, stores } from '../../server/db/schema'
import { createOrder, type CreateOrderDeps } from '../../server/services/ordering/create-order'
import { AppError } from '../../server/utils/errors'
import { decryptSecret } from '../../server/utils/crypto'
import { hashToken } from '../../server/utils/tokens'
import { breadItem, deliveryBody, dineInBody, insertRawOrder, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant, createStore } from '../support/fixtures'

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

const place = (body: CheckoutBody, opts: { ip?: string | null, slug?: string, deps?: CreateOrderDeps } = {}) =>
  createOrder(
    getDb(),
    { slug: opts.slug ?? tenant.store.slug, input: checkoutInputSchema.parse(body), ip: opts.ip === undefined ? '203.0.113.7' : opts.ip },
    opts.deps,
  )

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(AppError)
  return error as AppError
}

const countOf = async (table: PgTable) =>
  (await getDb().select({ n: count() }).from(table))[0]!.n

beforeEach(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('createOrder — happy paths', () => {
  it('creates a PICKUP COD order with snapshots, hashed + encrypted guest token and one CREATED event', async () => {
    const { response, replayed } = await place(pickupBody(menu, { note: ' ít đá ' }))

    expect(replayed).toBe(false)
    expect(response).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })
    expect(response.publicCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
    expect(response.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(response).not.toHaveProperty('qr')

    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({
      storeId: tenant.store.id,
      orgId: tenant.org.id,
      fulfillmentType: 'PICKUP',
      customerName: 'Lan',
      customerPhone: '0912345678',
      notes: 'ít đá',
      subtotalVnd: 70_000,
      deliveryFeeVnd: 0,
      totalVnd: 70_000,
      status: 'NEW',
      paymentMethod: 'PAY_ON_RECEIPT',
      paymentStatus: 'UNPAID',
      latePayment: false,
      tableId: null,
      deliveryZoneId: null,
    })
    expect(order!.guestTokenHash).toBe(hashToken(response.guestToken))
    expect(order!.guestTokenEncrypted).not.toContain(response.guestToken)
    expect(decryptSecret(order!.guestTokenEncrypted)).toBe(response.guestToken)

    const items = await getDb().select().from(orderItems)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      orderId: order!.id,
      productId: menu.tea.id,
      position: 0,
      nameSnapshot: 'Trà sữa trân châu',
      qty: 2,
      unitPriceVnd: 35_000,
      lineTotalVnd: 70_000,
      optionsSnapshotJson: [{ groupId: menu.tea.size.groupId, groupName: 'Size', valueId: menu.tea.size.m.id, valueName: 'M', priceDeltaVnd: 0 }],
    })

    const events = await getDb().select().from(orderEvents)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      orderId: order!.id,
      eventType: 'CREATED',
      fromState: null,
      toState: 'NEW',
      actorUserId: null,
      metadata: { paymentMethod: 'PAY_ON_RECEIPT', fulfillmentType: 'PICKUP', itemCount: 1 },
    })
    expect(JSON.stringify(events[0]!.metadata)).not.toContain('0912345678')
  })

  it('creates a DINE_IN order bound to the table behind the token, with no customer data required', async () => {
    const { response } = await place(dineInBody(menu))
    expect(response.status).toBe('NEW')
    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({ fulfillmentType: 'DINE_IN', tableId: menu.table.id, tableLabel: 'Bàn 05', customerName: null, customerPhone: null })
  })

  it('creates a DELIVERY order with the zone fee added and the address snapshot kept', async () => {
    const { response } = await place(deliveryBody(menu))
    expect(response.totalVnd).toBe(85_000)
    const [order] = await getDb().select().from(orders)
    expect(order).toMatchObject({
      fulfillmentType: 'DELIVERY',
      deliveryZoneId: menu.zone.id,
      deliveryZoneName: 'Quận 1',
      addressSnapshot: '12 Lê Lợi, Quận 1',
      subtotalVnd: 70_000,
      deliveryFeeVnd: 15_000,
      totalVnd: 85_000,
    })
  })

  it('recomputes prices on the server: size L + two toppings, several lines', async () => {
    const tea = teaItem(menu, {
      quantity: 1,
      optionValueIds: [menu.tea.size.l.id, menu.tea.topping.pearl.id, menu.tea.topping.jelly.id],
      expectedUnitPriceVnd: 35_000 + 7_000 + 5_000 + 5_000,
      note: 'ít ngọt',
    })
    const { response } = await place(pickupBody(menu, { items: [tea, breadItem(menu, { quantity: 3 })], expectedTotalVnd: 52_000 + 60_000 }))
    expect(response.totalVnd).toBe(112_000)

    const items = await getDb().select().from(orderItems).orderBy(orderItems.position)
    expect(items.map(item => [item.nameSnapshot, item.qty, item.unitPriceVnd, item.lineTotalVnd, item.note])).toEqual([
      ['Trà sữa trân châu', 1, 52_000, 52_000, 'ít ngọt'],
      ['Bánh mì que', 3, 20_000, 60_000, null],
    ])
    expect(items[0]!.optionsSnapshotJson.map(option => option.valueName)).toEqual(['L', 'Trân châu', 'Thạch'])
  })

  it('keeps the snapshot after the catalog changes', async () => {
    await place(pickupBody(menu))
    await getDb().update(products).set({ name: 'Tên mới', basePriceVnd: 99_000 }).where(eq(products.id, menu.tea.id))
    await getDb().update(productOptionValues).set({ name: 'Đổi tên' }).where(eq(productOptionValues.id, menu.tea.size.m.id))
    const [item] = await getDb().select().from(orderItems)
    expect(item).toMatchObject({ nameSnapshot: 'Trà sữa trân châu', unitPriceVnd: 35_000, lineTotalVnd: 70_000 })
    expect(item!.optionsSnapshotJson[0]).toMatchObject({ valueName: 'M' })
  })
})

describe('createOrder — store, mode, table, zone, payment checks', () => {
  it('404 for an unknown or suspended store', async () => {
    expect((await appError(place(pickupBody(menu), { slug: 'khong-co-quan-nay' }))).code).toBe('NOT_FOUND')
    await getDb().update(stores).set({ status: 'SUSPENDED' }).where(eq(stores.id, tenant.store.id))
    expect((await appError(place(pickupBody(menu)))).code).toBe('NOT_FOUND')
  })

  it('422 STORE_CLOSED when the store stopped accepting orders; the cart is untouched', async () => {
    await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, tenant.store.id))
    const error = await appError(place(pickupBody(menu)))
    expect(error).toMatchObject({ code: 'STORE_CLOSED', status: 422 })
    expect(await countOf(orders)).toBe(0)
  })

  it.each([
    ['PICKUP', { pickupEnabled: false }, (m: SeededMenu) => pickupBody(m)],
    ['DINE_IN', { dineInEnabled: false }, (m: SeededMenu) => dineInBody(m)],
    ['DELIVERY', { deliveryEnabled: false }, (m: SeededMenu) => deliveryBody(m)],
  ])('422 MODE_DISABLED when %s is switched off', async (_mode, patch, makeBody) => {
    await getDb().update(stores).set(patch).where(eq(stores.id, tenant.store.id))
    expect(await appError(place(makeBody(menu)))).toMatchObject({ code: 'MODE_DISABLED', status: 422 })
  })

  it('422 INVALID_TABLE for a wrong, revoked or foreign table token', async () => {
    expect((await appError(place(dineInBody(menu, { tableToken: 'z'.repeat(43) })))).code).toBe('INVALID_TABLE')

    await getDb().update(storeTables).set({ active: false }).where(eq(storeTables.id, menu.table.id))
    expect((await appError(place(dineInBody(menu)))).code).toBe('INVALID_TABLE')

    const other = await createTenant('b')
    const otherMenu = await seedMenu(other.store)
    await getDb().update(storeTables).set({ active: true }).where(eq(storeTables.id, menu.table.id))
    expect((await appError(place(dineInBody(menu, { tableToken: otherMenu.table.token })))).code).toBe('INVALID_TABLE')
    expect(await countOf(orders)).toBe(0)
  })

  it('422 INVALID_ZONE for an unknown, inactive or foreign zone', async () => {
    expect((await appError(place(deliveryBody(menu, { deliveryZoneId: randomUUID() })))).code).toBe('INVALID_ZONE')

    await getDb().update(deliveryZones).set({ active: false }).where(eq(deliveryZones.id, menu.zone.id))
    expect((await appError(place(deliveryBody(menu)))).code).toBe('INVALID_ZONE')

    const other = await createTenant('b')
    const otherMenu = await seedMenu(other.store)
    expect((await appError(place(deliveryBody(menu, { deliveryZoneId: otherMenu.zone.id })))).code).toBe('INVALID_ZONE')
  })

  it('422 PAYMENT_METHOD_UNAVAILABLE for BANK_QR until PR5 and creates nothing', async () => {
    expect(await appError(place(pickupBody(menu, { paymentMethod: 'BANK_QR' })))).toMatchObject({ code: 'PAYMENT_METHOD_UNAVAILABLE', status: 422 })
    expect(await countOf(orders)).toBe(0)
  })
})

describe('createOrder — CART_STALE (Review Focus #7)', () => {
  const stale = async (body: CheckoutBody) => {
    const error = await appError(place(body))
    expect(error).toMatchObject({ code: 'CART_STALE', status: 409 })
    return error.details as { lines: Record<string, unknown>[], deliveryFeeVnd: number | null, totalVnd: number | null }
  }

  it('names a product that sold out and creates nothing', async () => {
    await getDb().update(products).set({ isAvailable: false }).where(eq(products.id, menu.bread.id))
    const details = await stale(pickupBody(menu, { items: [teaItem(menu, { quantity: 1 }), breadItem(menu)], expectedTotalVnd: 55_000 }))
    expect(details.lines).toEqual([{ index: 1, productId: menu.bread.id, name: 'Bánh mì que', reason: 'PRODUCT_UNAVAILABLE', currentUnitPriceVnd: null }])
    expect(await countOf(orders)).toBe(0)
  })

  it('treats a deactivated or unknown product as unavailable', async () => {
    await getDb().update(products).set({ active: false }).where(eq(products.id, menu.bread.id))
    const details = await stale(pickupBody(menu, { items: [breadItem(menu), breadItem(menu, { productId: randomUUID() })], expectedTotalVnd: 40_000 }))
    expect(details.lines.map(line => [line.index, line.reason, line.name])).toEqual([[0, 'PRODUCT_UNAVAILABLE', 'Bánh mì que'], [1, 'PRODUCT_UNAVAILABLE', null]])
  })

  it('uses the NEW price, reports it, and never the old one', async () => {
    await getDb().update(products).set({ basePriceVnd: 38_000 }).where(eq(products.id, menu.tea.id))
    const details = await stale(pickupBody(menu))
    expect(details.lines).toEqual([{ index: 0, productId: menu.tea.id, name: 'Trà sữa trân châu', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 38_000 }])
    expect(await countOf(orders)).toBe(0)

    const { response } = await place(pickupBody(menu, { items: [teaItem(menu, { expectedUnitPriceVnd: 38_000 })], expectedTotalVnd: 76_000 }))
    expect(response.totalVnd).toBe(76_000)
    const [item] = await getDb().select().from(orderItems)
    expect(item!.unitPriceVnd).toBe(38_000)
  })

  it('reports a price change that comes from an option delta', async () => {
    await getDb().update(productOptionValues).set({ priceDeltaVnd: 9_000 }).where(eq(productOptionValues.id, menu.tea.size.l.id))
    const details = await stale(pickupBody(menu, {
      items: [teaItem(menu, { optionValueIds: [menu.tea.size.l.id], expectedUnitPriceVnd: 42_000 })],
      expectedTotalVnd: 84_000,
    }))
    expect(details.lines[0]).toMatchObject({ reason: 'PRICE_CHANGED', currentUnitPriceVnd: 44_000 })
  })

  it.each([
    ['an option the owner switched off', async (m: SeededMenu) => {
      await getDb().update(productOptionValues).set({ active: false }).where(eq(productOptionValues.id, m.tea.size.m.id))
      return teaItem(m)
    }],
    ['a missing required option', async (m: SeededMenu) => teaItem(m, { optionValueIds: [] })],
    ['too many toppings', async (m: SeededMenu) => teaItem(m, { optionValueIds: [m.tea.size.m.id, m.tea.topping.pearl.id, m.tea.topping.jelly.id, m.tea.size.l.id] })],
    ['an option of another product', async (m: SeededMenu) => breadItem(m, { optionValueIds: [m.tea.topping.pearl.id] })],
    ['an unknown option id', async (m: SeededMenu) => teaItem(m, { optionValueIds: [randomUUID()] })],
  ])('flags %s as OPTION_INVALID', async (_label, makeItem) => {
    const item = await makeItem(menu)
    const details = await stale(pickupBody(menu, { items: [item], expectedTotalVnd: 1 }))
    expect(details.lines).toHaveLength(1)
    expect(details.lines[0]).toMatchObject({ index: 0, reason: 'OPTION_INVALID' })
  })

  it('reports a changed delivery fee with the new total and no stale lines', async () => {
    await getDb().update(deliveryZones).set({ feeVnd: 20_000 }).where(eq(deliveryZones.id, menu.zone.id))
    const details = await stale(deliveryBody(menu))
    expect(details).toEqual({ lines: [], deliveryFeeVnd: 20_000, totalVnd: 90_000 })
  })

  it('rejects a total that does not match even when every line matches', async () => {
    const details = await stale(pickupBody(menu, { expectedTotalVnd: 1 }))
    expect(details).toEqual({ lines: [], deliveryFeeVnd: null, totalVnd: 70_000 })
  })
})

describe('createOrder — idempotency (Review Focus #8)', () => {
  it('returns the same order and the same guest token for a sequential retry, and does not spend rate limit', async () => {
    const body = pickupBody(menu)
    const first = await place(body)
    const spent = await getDb().select().from(rateLimits)
    const retry = await place(body)

    expect(retry.replayed).toBe(true)
    expect(retry.response).toEqual(first.response)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderEvents)).toBe(1)
    expect(await getDb().select().from(rateLimits)).toEqual(spent)
  })

  it('still replays after the store closed or the catalog changed', async () => {
    const body = pickupBody(menu)
    const first = await place(body)
    await getDb().update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, tenant.store.id))
    await getDb().update(products).set({ basePriceVnd: 1 }).where(eq(products.id, menu.tea.id))
    expect((await place(body)).response).toEqual(first.response)
  })

  it('creates exactly one order when 5 identical requests race', async () => {
    const body = pickupBody(menu)
    const results = await Promise.all(Array.from({ length: 5 }, () => place(body)))

    expect(new Set(results.map(result => result.response.guestToken)).size).toBe(1)
    expect(new Set(results.map(result => result.response.publicCode)).size).toBe(1)
    expect(results.filter(result => !result.replayed)).toHaveLength(1)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderItems)).toBe(1)
    expect(await countOf(orderEvents)).toBe(1)
  })

  it('scopes keys per store: the same key in another store is a different order', async () => {
    const other = await createTenant('b')
    await openStore(other.store.id)
    const otherMenu = await seedMenu(other.store)
    const key = randomUUID()
    const a = await place(pickupBody(menu, { idempotencyKey: key }))
    const b = await place(pickupBody(otherMenu, { idempotencyKey: key }), { slug: other.store.slug })
    expect(b.replayed).toBe(false)
    expect(b.response.guestToken).not.toBe(a.response.guestToken)
    expect(await countOf(orders)).toBe(2)
  })
})

// These cases execute ten real checkout transactions serially against one rate-limit row.
// CI's remote DB round trips are slower than local; keep all ten checkouts and their assertions.
describe('createOrder — rate limit', { timeout: 120_000 }, () => {
  beforeEach(() => {
    // Freeze the rate window, but leave socket and timeout timers real.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-31T10:03:20Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('allows 10 orders per ip+store per window, then 429, but still replays old keys', async () => {
    const firstBody = pickupBody(menu)
    const first = await place(firstBody)
    for (let i = 1; i < 10; i++) await place(pickupBody(menu))

    const error = await appError(place(pickupBody(menu)))
    expect(error).toMatchObject({ code: 'RATE_LIMITED', status: 429 })
    expect(await countOf(orders)).toBe(10)

    const spent = await getDb().select().from(rateLimits)
    expect((await place(firstBody)).response).toEqual(first.response)
    expect(await getDb().select().from(rateLimits)).toEqual(spent)
    await place(pickupBody(menu), { ip: '198.51.100.9' })
    expect(await countOf(orders)).toBe(11)
  })

  it('counts rejected carts too, so spamming invalid orders is not free', async () => {
    for (let i = 0; i < 10; i++) await appError(place(pickupBody(menu, { expectedTotalVnd: 1 })))
    expect((await appError(place(pickupBody(menu)))).code).toBe('RATE_LIMITED')
    expect(await countOf(orders)).toBe(0)
  })

  it('tracks the limit per store', async () => {
    const other = await createStore(tenant.org.id, 'b')
    await openStore(other.id)
    const otherMenu = await seedMenu(other)
    for (let i = 0; i < 10; i++) await place(pickupBody(menu))
    expect(await appError(place(pickupBody(menu)))).toMatchObject({ code: 'RATE_LIMITED', status: 429 })
    expect((await place(pickupBody(otherMenu), { slug: other.slug })).replayed).toBe(false)
    expect(await countOf(orders)).toBe(11)
  })
})

describe('createOrder — public code and atomicity', () => {
  it('retries a colliding public code and succeeds with the next one', async () => {
    await insertRawOrder(tenant.store, { publicCode: 'AAAAAA' })
    const generate = vi.fn().mockReturnValueOnce('AAAAAA').mockReturnValueOnce('AAAAAA').mockReturnValue('BBBBBB')
    const { response } = await place(pickupBody(menu), { deps: { generatePublicCode: generate } })
    expect(response.publicCode).toBe('BBBBBB')
    expect(generate).toHaveBeenCalledTimes(3)
  })

  it('gives up after 5 colliding codes and leaves nothing behind', async () => {
    await insertRawOrder(tenant.store, { publicCode: 'AAAAAA' })
    const generate = vi.fn().mockReturnValue('AAAAAA')
    await expect(place(pickupBody(menu), { deps: { generatePublicCode: generate } })).rejects.toThrow('public code')
    expect(generate).toHaveBeenCalledTimes(5)
    expect(await countOf(orders)).toBe(1)
    expect(await countOf(orderItems)).toBe(0)
  })

  it('rolls everything back when the transaction fails before commit', async () => {
    const boom = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(place(pickupBody(menu), { deps: { beforeCommit: boom } })).rejects.toThrow('boom')
    expect(await countOf(orders)).toBe(0)
    expect(await countOf(orderItems)).toBe(0)
    expect(await countOf(orderEvents)).toBe(0)
  })
})


describe('createOrder — transaction admission races', () => {
  it('rechecks store flags after entering the transaction', async () => {
    const db = getDb()
    const transaction = db.transaction.bind(db)
    const gate = vi.spyOn(db, 'transaction').mockImplementationOnce(async (callback, config) => {
      await db.update(stores).set({ isAcceptingOrders: false }).where(eq(stores.id, tenant.store.id))
      return transaction(callback, config)
    })
    try {
      expect(await appError(place(pickupBody(menu)))).toMatchObject({ code: 'STORE_CLOSED' })
      expect(await countOf(orders)).toBe(0)
    }
    finally { gate.mockRestore() }
  })

  it('replays simultaneous same-key requests at the rate boundary without charging twice', async () => {
    for (let i = 0; i < 9; i++) await place(pickupBody(menu))
    const body = pickupBody(menu)
    const results = await Promise.all([place(body), place(body)])
    expect(results[0]!.response).toEqual(results[1]!.response)
    expect(results.filter(result => result.replayed)).toHaveLength(1)
    expect((await getDb().select().from(rateLimits))[0]!.count).toBe(10)
  })
})
