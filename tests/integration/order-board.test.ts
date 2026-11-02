import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { OrderStatus } from '../../shared/enums'
import type { BoardTab } from '../../shared/order-flow'
import type { StoreContext } from '../../server/auth/guards'
import { closeDb, getDb } from '../../server/db/client'
import { insertOrderEvent } from '../../server/repositories/orders'
import { decodeCursor, encodeCursor, getOrderDetail, listBoard } from '../../server/services/ordering/board'
import { resetDb } from '../support/db'
import { addStaff, createTenant } from '../support/fixtures'
import { createOrderItem, createOrderRow, createPaymentRow } from '../support/order-fixtures'

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

describe('listBoard tabs', () => {
  it('puts each status in exactly one tab and keeps AWAITING_PAYMENT out of "new"', async () => {
    const a = await createTenant('tabs')
    const mk = (status: OrderStatus, extra: Partial<Parameters<typeof createOrderRow>[1]> = {}) =>
      createOrderRow(a.store, { status, ...extra })
    const awaiting = await mk('AWAITING_PAYMENT', { paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const fresh = await mk('NEW')
    const preparing = await mk('PREPARING')
    const ready = await mk('READY')
    const delivering = await mk('DELIVERING', { fulfillmentType: 'DELIVERY' })
    const done = await mk('COMPLETED', { paymentStatus: 'PAID' })
    const cancelled = await mk('CANCELLED')
    const ctx = ctxOf(a)

    const ids = async (tab: BoardTab) => (await listBoard(getDb(), ctx, { tab })).orders.map(o => o.id).sort()
    expect(await ids('new')).toEqual([fresh.id])
    expect(await ids('doing')).toEqual([preparing.id])
    expect(await ids('ready')).toEqual([ready.id, delivering.id].sort())
    expect(await ids('other')).toEqual([done.id, cancelled.id].sort())
    expect(await ids('awaiting_payment')).toEqual([awaiting.id])
  })

  it('returns counts and newOrderIds without AWAITING_PAYMENT', async () => {
    const a = await createTenant('counts')
    await createOrderRow(a.store, { status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })
    const n1 = await createOrderRow(a.store, { status: 'NEW' })
    const n2 = await createOrderRow(a.store, { status: 'NEW' })
    await createOrderRow(a.store, { status: 'PREPARING' })
    await createOrderRow(a.store, { status: 'READY' })
    await createOrderRow(a.store, { status: 'DELIVERING', fulfillmentType: 'DELIVERY' })
    await createOrderRow(a.store, { status: 'COMPLETED' })

    const board = await listBoard(getDb(), ctxOf(a), { tab: 'doing' })
    expect(board.counts).toEqual({ new: 2, doing: 1, ready: 2, awaiting_payment: 1, other: 0 })
    expect(board.newOrderIds.sort()).toEqual([n1.id, n2.id].sort())
    expect(Date.parse(board.serverTime)).not.toBeNaN()
  })

  it('orders active tabs oldest-first and "other" newest-first', async () => {
    const a = await createTenant('order')
    const old = await createOrderRow(a.store, { status: 'NEW', createdAt: new Date('2026-11-01T01:00:00Z') })
    const mid = await createOrderRow(a.store, { status: 'NEW', createdAt: new Date('2026-11-01T02:00:00Z') })
    const doneOld = await createOrderRow(a.store, { status: 'COMPLETED', createdAt: new Date('2026-11-01T01:00:00Z') })
    const doneNew = await createOrderRow(a.store, { status: 'COMPLETED', createdAt: new Date('2026-11-01T02:00:00Z') })
    expect((await listBoard(getDb(), ctxOf(a), { tab: 'new' })).orders.map(o => o.id)).toEqual([old.id, mid.id])
    expect((await listBoard(getDb(), ctxOf(a), { tab: 'other' })).orders.map(o => o.id)).toEqual([doneNew.id, doneOld.id])
  })

  it('never returns another store\'s orders', async () => {
    const a = await createTenant('iso-a')
    const b = await createTenant('iso-b')
    await createOrderRow(b.store, { status: 'NEW' })
    const board = await listBoard(getDb(), ctxOf(a), { tab: 'new' })
    expect(board.orders).toEqual([])
    expect(board.counts.new).toBe(0)
    expect(board.newOrderIds).toEqual([])
  })
})

describe('listBoard card data', () => {
  it('includes items with option labels, table name and customer contact', async () => {
    const a = await createTenant('card')
    const order = await createOrderRow(a.store, { fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', notes: 'Ít ngọt' })
    await createOrderItem(order, { nameSnapshot: 'Trà đào', optionsSnapshotJson: [{ groupId: randomUUID(), groupName: 'Đường', valueId: randomUUID(), valueName: '30%', priceDeltaVnd: 0 }], qty: 1, unitPriceVnd: 45_000, lineTotalVnd: 45_000 })
    await createOrderItem(order, { nameSnapshot: 'Cà phê sữa', optionsSnapshotJson: [], qty: 2, unitPriceVnd: 20_000, lineTotalVnd: 40_000 })

    const [card] = (await listBoard(getDb(), ctxOf(a), { tab: 'new' })).orders
    expect(card).toMatchObject({
      id: order.id,
      publicCode: order.publicCode,
      status: 'NEW',
      fulfillmentType: 'DINE_IN',
      tableName: 'Bàn 05',
      customerName: 'Lan',
      customerPhone: '0912345678',
      notes: 'Ít ngọt',
      totalVnd: 50_000,
      paymentStatus: 'UNPAID',
    })
    expect(card!.items.map(i => ({ name: i.name, qty: i.qty, options: i.options }))).toEqual(
      expect.arrayContaining([
        { name: 'Trà đào', qty: 1, options: ['30%'] },
        { name: 'Cà phê sữa', qty: 2, options: [] },
      ]),
    )
    expect(card!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(card)).not.toMatch(/guestToken|idempotencyKey/i)
  })
})

describe('listBoard pagination', () => {
  it('pages through 35 orders sharing one created_at without duplicates or gaps', async () => {
    const a = await createTenant('page')
    const sameInstant = new Date('2026-11-01T03:00:00.000Z')
    for (let i = 0; i < 35; i++) await createOrderRow(a.store, { status: 'NEW', createdAt: sameInstant })

    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 5; i++) {
      const page = await listBoard(getDb(), ctxOf(a), { tab: 'new', cursor })
      expect(page.orders.length).toBeLessThanOrEqual(30)
      seen.push(...page.orders.map(o => o.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toHaveLength(35)
    expect(new Set(seen).size).toBe(35)
    expect(seen).toEqual([...seen].sort())
  })

  it('keeps microsecond precision in the cursor (no repeated row between pages)', async () => {
    const a = await createTenant('micro')
    const rows = [await createOrderRow(a.store), await createOrderRow(a.store), await createOrderRow(a.store)]
    const stamps = ['2026-11-01 10:00:00.123456+00', '2026-11-01 10:00:00.123457+00', '2026-11-01 10:00:00.123458+00']
    for (const [i, row] of rows.entries()) {
      await getDb().execute(sql`update orders set created_at = ${stamps[i]!}::timestamptz where id = ${row.id}`)
    }
    const seen: string[] = []
    let cursor: string | undefined
    for (let i = 0; i < 4; i++) {
      const page = await listBoard(getDb(), ctxOf(a), { tab: 'new', cursor, limit: 1 })
      seen.push(...page.orders.map(o => o.id))
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    expect(seen).toEqual(rows.map(r => r.id))
  })

  it('rejects a malformed cursor with VALIDATION_FAILED', async () => {
    const a = await createTenant('badcursor')
    for (const cursor of ['not-base64-json', encodeCursor({ createdAt: 'yesterday', id: randomUUID() }), Buffer.from('{"t":1}').toString('base64url')]) {
      await expect(listBoard(getDb(), ctxOf(a), { tab: 'new', cursor })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' })
    }
  })

  it('round-trips a cursor', () => {
    const cursor = { createdAt: '2026-11-01 10:00:00.123456+00', id: randomUUID() }
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor)
  })
})

describe('getOrderDetail', () => {
  it('returns the order, events in chronological order with actor names, and the payment', async () => {
    const a = await createTenant('detail')
    const staff = await addStaff(a.store)
    const order = await createOrderRow(a.store, { status: 'PREPARING', paymentStatus: 'PAID' })
    await createOrderItem(order)
    await createPaymentRow(order, { amountVnd: order.totalVnd, recordedBy: staff.userId, note: 'Tiền mặt' })
    const scope = { orgId: a.org.id, storeId: a.store.id }
    await insertOrderEvent(getDb(), scope, { orderId: order.id, actorUserId: a.owner.userId, eventType: 'STATUS_CHANGED', fromState: 'NEW', toState: 'PREPARING' })
    await insertOrderEvent(getDb(), scope, { orderId: order.id, actorUserId: staff.userId, eventType: 'PAYMENT_RECORDED', metadata: { method: 'CASH' } })

    const detail = await getOrderDetail(getDb(), ctxOf(a), order.id)
    expect(detail.order).toMatchObject({ id: order.id, status: 'PREPARING', items: [expect.objectContaining({ name: 'Trà sữa trân châu', options: ['50%'] })] })
    expect(detail.events.map(e => e.eventType)).toEqual(['STATUS_CHANGED', 'PAYMENT_RECORDED'])
    expect(detail.events[0]).toMatchObject({ fromState: 'NEW', toState: 'PREPARING' })
    expect(detail.events[1]!.actorName).toBeTruthy()
    expect(detail.payment).toMatchObject({ method: 'CASH', amountVnd: 50_000, note: 'Tiền mặt' })
  })

  it('returns payment null for an unpaid order', async () => {
    const a = await createTenant('nopay')
    const order = await createOrderRow(a.store)
    expect((await getOrderDetail(getDb(), ctxOf(a), order.id)).payment).toBeNull()
  })

  it('treats another store\'s order and a random id the same (NOT_FOUND)', async () => {
    const a = await createTenant('d-a')
    const b = await createTenant('d-b')
    const orderOfB = await createOrderRow(b.store)
    await expect(getOrderDetail(getDb(), ctxOf(a), orderOfB.id)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(getOrderDetail(getDb(), ctxOf(a), randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
