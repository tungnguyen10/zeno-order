import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import type { OrderStatus, PaymentStatus } from '#shared/enums'
import type { OrderEventType } from '#shared/order-flow'
import type { DbOrTx } from '../db/client'
import { orderEvents, orderItems, orderPayments, orders, userProfiles } from '../db/schema'

export interface OrderScope {
  orgId: string
  storeId: string
}

export interface OrderCursor {
  createdAt: string
  id: string
}

export type OrderRow = typeof orders.$inferSelect

const inScope = (scope: OrderScope) => and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId))
const ACTIVE_STATUSES: OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING']

export async function listOrders(
  db: DbOrTx,
  scope: OrderScope,
  opts: { statuses: readonly OrderStatus[], direction: 'asc' | 'desc', limit: number, cursor?: OrderCursor },
) {
  const { cursor, direction } = opts
  // Row-value so sánh khớp đúng thứ tự (created_at, id), không bỏ sót đơn cùng created_at.
  const keyset = cursor
    ? direction === 'asc'
      ? sql`(${orders.createdAt}, ${orders.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
      : sql`(${orders.createdAt}, ${orders.id}) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)`
    : undefined
  const ordering = direction === 'asc' ? [asc(orders.createdAt), asc(orders.id)] : [desc(orders.createdAt), desc(orders.id)]
  return db
    .select({
      order: orders,
      // ::text giữ đủ micro giây; Date của JS chỉ có mili giây nên không dùng làm cursor.
      createdAtCursor: sql<string>`${orders.createdAt}::text`,
    })
    .from(orders)
    .where(and(inScope(scope), inArray(orders.status, [...opts.statuses]), keyset))
    .orderBy(...ordering)
    .limit(opts.limit + 1)
}

export async function countByStatus(db: DbOrTx, scope: OrderScope): Promise<Partial<Record<OrderStatus, number>>> {
  const rows = await db
    .select({ status: orders.status, count: sql<number>`count(*)::int` })
    .from(orders)
    .where(and(inScope(scope), inArray(orders.status, ACTIVE_STATUSES)))
    .groupBy(orders.status)
  return Object.fromEntries(rows.map(row => [row.status, row.count]))
}

export async function listStatusIds(db: DbOrTx, scope: OrderScope, status: OrderStatus, limit: number): Promise<string[]> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(inScope(scope), eq(orders.status, status)))
    .orderBy(asc(orders.createdAt), asc(orders.id))
    .limit(limit)
  return rows.map(row => row.id)
}

export async function listItems(db: DbOrTx, scope: OrderScope, orderIds: string[]) {
  if (orderIds.length === 0) return []
  return db
    .select()
    .from(orderItems)
    .where(and(eq(orderItems.orgId, scope.orgId), eq(orderItems.storeId, scope.storeId), inArray(orderItems.orderId, orderIds)))
    .orderBy(asc(orderItems.position), asc(orderItems.id))
}

export async function findBoardRow(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(inScope(scope), eq(orders.id, orderId)))
    .limit(1)
  return row ?? null
}

export async function listEvents(db: DbOrTx, scope: OrderScope, orderId: string) {
  return db
    .select({
      id: orderEvents.id,
      eventType: orderEvents.eventType,
      fromState: orderEvents.fromState,
      toState: orderEvents.toState,
      metadata: orderEvents.metadata,
      createdAt: orderEvents.createdAt,
      actorName: userProfiles.displayName,
      actorEmail: userProfiles.email,
    })
    .from(orderEvents)
    .leftJoin(userProfiles, eq(userProfiles.userId, orderEvents.actorUserId))
    .where(and(eq(orderEvents.orgId, scope.orgId), eq(orderEvents.storeId, scope.storeId), eq(orderEvents.orderId, orderId)))
    .orderBy(asc(orderEvents.createdAt), asc(orderEvents.id))
}

export async function findPayment(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select()
    .from(orderPayments)
    .where(and(eq(orderPayments.orgId, scope.orgId), eq(orderPayments.storeId, scope.storeId), eq(orderPayments.orderId, orderId)))
    .limit(1)
  return row ?? null
}

export async function findOrderState(db: DbOrTx, scope: OrderScope, orderId: string) {
  const [row] = await db
    .select({
      id: orders.id,
      status: orders.status,
      fulfillmentType: orders.fulfillmentType,
      paymentMethod: orders.paymentMethod,
      paymentStatus: orders.paymentStatus,
      totalVnd: orders.totalVnd,
    })
    .from(orders)
    .where(and(inScope(scope), eq(orders.id, orderId)))
    .limit(1)
  return row ?? null
}

/**
 * Chuyển trạng thái có điều kiện: chỉ cập nhật nếu đơn vẫn ở `from` (và, nếu có, vẫn ở `onlyIfPaymentStatus`).
 * Trả null khi 0 dòng khớp, tức là người khác đã đổi đơn trước.
 */
export async function transitionOrder(
  db: DbOrTx,
  scope: OrderScope,
  orderId: string,
  change: { from: OrderStatus, to: OrderStatus, onlyIfPaymentStatus?: PaymentStatus, setPaymentStatus?: PaymentStatus },
) {
  const [row] = await db
    .update(orders)
    .set({ status: change.to, ...(change.setPaymentStatus ? { paymentStatus: change.setPaymentStatus } : {}) })
    .where(and(
      inScope(scope),
      eq(orders.id, orderId),
      eq(orders.status, change.from),
      change.onlyIfPaymentStatus ? eq(orders.paymentStatus, change.onlyIfPaymentStatus) : undefined,
    ))
    .returning({ id: orders.id, status: orders.status, paymentStatus: orders.paymentStatus })
  return row ?? null
}

/** Đặt `PAID` chỉ khi payment_status còn đúng giá trị mong đợi và đơn chưa bị hủy. */
export async function markOrderPaid(db: DbOrTx, scope: OrderScope, orderId: string, expected: PaymentStatus) {
  const [row] = await db
    .update(orders)
    .set({ paymentStatus: 'PAID' })
    .where(and(inScope(scope), eq(orders.id, orderId), eq(orders.paymentStatus, expected), ne(orders.status, 'CANCELLED')))
    .returning({ id: orders.id, status: orders.status, paymentStatus: orders.paymentStatus })
  return row ?? null
}

export async function insertOrderEvent(
  db: DbOrTx,
  scope: OrderScope,
  event: {
    orderId: string
    actorUserId: string
    eventType: OrderEventType
    fromState?: OrderStatus | null
    toState?: OrderStatus | null
    metadata?: Record<string, unknown>
  },
) {
  await db.insert(orderEvents).values({
    orgId: scope.orgId,
    storeId: scope.storeId,
    orderId: event.orderId,
    actorUserId: event.actorUserId,
    eventType: event.eventType,
    fromState: event.fromState ?? null,
    toState: event.toState ?? null,
    ...(event.metadata ? { metadata: event.metadata } : {}),
  })
}

export async function insertCashPayment(
  db: DbOrTx,
  scope: OrderScope,
  payment: { orderId: string, amountVnd: number, recordedBy: string, note: string | null },
) {
  await db.insert(orderPayments).values({
    orgId: scope.orgId,
    storeId: scope.storeId,
    orderId: payment.orderId,
    method: 'CASH',
    amountVnd: payment.amountVnd,
    recordedBy: payment.recordedBy,
    note: payment.note,
  })
}
