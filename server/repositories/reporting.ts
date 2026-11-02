import { and, desc, eq, gte, lt, ne, sql } from 'drizzle-orm'
import type { DbOrTx } from '../db/client'
import { orderItems, orderPayments, orders } from '../db/schema'
import type { OrderScope } from './orders'

const inWindow = (scope: OrderScope, from: Date, to: Date) => and(
  eq(orders.orgId, scope.orgId),
  eq(orders.storeId, scope.storeId),
  gte(orders.createdAt, from),
  lt(orders.createdAt, to),
)

const joinOrders = and(eq(orders.orgId, orderPayments.orgId), eq(orders.storeId, orderPayments.storeId), eq(orders.id, orderPayments.orderId))

// Literal (không bind param) để SELECT và GROUP BY cùng một biểu thức; PG từ chối khi hai biểu thức dùng param khác nhau.
const VN_DAY = sql<string>`to_char(${orders.createdAt} at time zone 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`

export async function orderTotals(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      completed: sql<number>`(count(*) filter (where ${orders.status} = 'COMPLETED'))::int`,
      cancelled: sql<number>`(count(*) filter (where ${orders.status} = 'CANCELLED'))::int`,
      gross: sql<number>`coalesce(sum(${orders.totalVnd}) filter (where ${orders.status} <> 'CANCELLED'), 0)::double precision`,
    })
    .from(orders)
    .where(inWindow(scope, from, to))
  return row!
}

export async function collectedByMethod(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  const rows = await db
    .select({ method: orderPayments.method, amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(orderPayments.method)
  return Object.fromEntries(rows.map(row => [row.method, row.amount])) as Partial<Record<'SEPAY' | 'CASH' | 'BANK_MANUAL', number>>
}

export async function refundDueTotal(db: DbOrTx, scope: OrderScope, from: Date, to: Date): Promise<number> {
  const [row] = await db
    .select({ amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), eq(orders.paymentStatus, 'REFUND_DUE')))
  return row!.amount
}

export async function topProducts(db: DbOrTx, scope: OrderScope, from: Date, to: Date, limit: number) {
  const qty = sql<number>`sum(${orderItems.qty})::int`
  return db
    .select({ name: orderItems.nameSnapshot, qty, revenueVnd: sql<number>`sum(${orderItems.lineTotalVnd})::double precision` })
    .from(orderItems)
    .innerJoin(orders, and(eq(orders.orgId, orderItems.orgId), eq(orders.storeId, orderItems.storeId), eq(orders.id, orderItems.orderId)))
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(orderItems.nameSnapshot)
    .orderBy(desc(qty), orderItems.nameSnapshot)
    .limit(limit)
}

export async function dailyValue(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  return db
    .select({
      day: VN_DAY,
      orderCount: sql<number>`count(*)::int`,
      gross: sql<number>`coalesce(sum(${orders.totalVnd}), 0)::double precision`,
    })
    .from(orders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(VN_DAY)
}

export async function dailyCollected(db: DbOrTx, scope: OrderScope, from: Date, to: Date) {
  return db
    .select({ day: VN_DAY, amount: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::double precision` })
    .from(orderPayments)
    .innerJoin(orders, joinOrders)
    .where(and(inWindow(scope, from, to), ne(orders.status, 'CANCELLED')))
    .groupBy(VN_DAY)
}
