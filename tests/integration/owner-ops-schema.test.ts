import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { getPgError } from '../../server/db/errors'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { createOrderRow, createPaymentRow } from '../support/order-fixtures'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeDb()
})

async function failure(run: () => Promise<unknown>) {
  try {
    await run()
  }
  catch (err) {
    return getPgError(err)
  }
  return {}
}

describe('order_payments', () => {
  it('stores a cash payment for an order', async () => {
    const a = await createTenant('pay')
    const order = await createOrderRow(a.store)
    const payment = await createPaymentRow(order, { amountVnd: order.totalVnd, recordedBy: a.owner.userId, note: 'Khách trả tiền mặt' })
    expect(payment).toMatchObject({ method: 'CASH', amountVnd: 50_000, bankTransactionId: null })
    expect(payment.recordedAt).toBeInstanceOf(Date)
  })

  it('rejects a payment whose order belongs to another store (composite FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderOfA = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow({ id: orderOfA.id, orgId: b.org.id, storeId: b.store.id }))
    expect(pg).toMatchObject({ code: '23503', constraint: 'order_payments_order_fk' })
  })

  it('rejects a store_id that is not under the org (tenant FK)', async () => {
    const a = await createTenant('a')
    const b = await createTenant('b')
    const orderOfA = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow({ id: orderOfA.id, orgId: b.org.id, storeId: a.store.id }))
    expect(pg).toMatchObject({ code: '23503', constraint: 'order_payments_store_fk' })
  })

  it('allows only one payment per order', async () => {
    const a = await createTenant('uq')
    const order = await createOrderRow(a.store)
    await createPaymentRow(order)
    const pg = await failure(() => createPaymentRow(order))
    expect(pg).toMatchObject({ code: '23505', constraint: 'order_payments_order_uq' })
  })

  it('rejects a negative amount', async () => {
    const a = await createTenant('neg')
    const order = await createOrderRow(a.store)
    const pg = await failure(() => createPaymentRow(order, { amountVnd: -1 }))
    expect(pg).toMatchObject({ code: '23514', constraint: 'order_payments_amount_nonneg' })
  })

  it('cascades when the order is deleted', async () => {
    const a = await createTenant('del')
    const order = await createOrderRow(a.store)
    await createPaymentRow(order)
    await getDb().execute(sql`delete from orders where id = ${order.id}`)
    const { rows } = await getDb().execute<{ n: number }>(sql`select count(*)::int as n from order_payments`)
    expect(rows[0]!.n).toBe(0)
  })
})

describe('board index', () => {
  it('orders(store_id, status, created_at desc) exists for the board query', async () => {
    const { rows } = await getDb().execute<{ indexdef: string }>(
      sql`select indexdef from pg_indexes where schemaname = 'public' and indexname = 'orders_board_idx'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.indexdef).toMatch(/\(store_id, status, created_at DESC(?: NULLS LAST)?\)/)
  })
})
