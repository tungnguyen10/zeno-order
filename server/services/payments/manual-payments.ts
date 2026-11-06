import { lockOrgPayments } from './payment-lock'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { OverdueOrder, ReconciliationSummary, RefundDueOrder } from '../../../shared/types/reconciliation'
import type { Db } from '../../db/client'
import { bankTransactionEvents, bankTransactions, orderEvents, orderPayments, orders } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph } from './lock-order-graph'

export interface StoreScope { orgId: string, storeId: string }
export interface ActorScope extends StoreScope { userId: string }

const uuid = z.uuid()
const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const overdueWhere = (scope: StoreScope) => and(
  eq(orders.orgId, scope.orgId),
  eq(orders.storeId, scope.storeId),
  eq(orders.status, 'AWAITING_PAYMENT'),
  inArray(orders.paymentStatus, ['PENDING', 'REVIEW_REQUIRED']),
  sql`exists (select 1 from payment_attempts a where a.order_id = ${orders.id})`,
  sql`not exists (select 1 from payment_attempts a where a.order_id = ${orders.id} and a.status = 'PENDING' and a.expires_at > now())`,
)

export async function listRefundDueOrders(db: Db, scope: StoreScope): Promise<RefundDueOrder[]> {
  const rows = await db.select({
    id: orders.id,
    publicCode: orders.publicCode,
    totalVnd: orders.totalVnd,
    createdAt: orders.createdAt,
  }).from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.paymentStatus, 'REFUND_DUE')))
    .orderBy(desc(orders.createdAt))
    .limit(100)
  if (rows.length === 0) return []
  const ids = rows.map(row => row.id)

  const collected = await db.select({ orderId: orderPayments.orderId, total: sql<number>`coalesce(sum(${orderPayments.amountVnd}), 0)::float8` })
    .from(orderPayments).where(and(eq(orderPayments.orgId, scope.orgId), isNull(orderPayments.refundedAt), inArray(orderPayments.orderId, ids))).groupBy(orderPayments.orderId)
  const waiting = await db.select({ orderId: bankTransactions.matchedOrderId, total: sql<number>`coalesce(sum(${bankTransactions.amountVnd}), 0)::float8` })
    .from(bankTransactions)
    .where(and(
      eq(bankTransactions.orgId, scope.orgId),
      inArray(bankTransactions.matchedOrderId, ids),
      eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED'),
      eq(bankTransactions.reviewReason, 'ORDER_CANCELLED'),
    ))
    .groupBy(bankTransactions.matchedOrderId)

  const held = new Map<string, number>()
  for (const row of collected) held.set(row.orderId, (held.get(row.orderId) ?? 0) + row.total)
  for (const row of waiting) if (row.orderId) held.set(row.orderId, (held.get(row.orderId) ?? 0) + row.total)

  return rows.map(row => ({
    id: row.id,
    publicCode: row.publicCode,
    totalVnd: row.totalVnd,
    heldVnd: held.get(row.id) ?? 0,
    createdAt: row.createdAt.toISOString(),
  }))
}

/** A bulk refund confirms the exact displayed outstanding amount; a newly arrived transfer conflicts. */
export async function markOrderRefunded(db: Db, ctx: ActorScope, input: { orderId: string, note: string, expectedHeldVnd: number }): Promise<void> {
  if (!uuid.safeParse(input.orderId).success) throw notFound()
  await db.transaction(async (tx) => {
    await lockOrgPayments(tx, ctx.orgId)
    const { order } = await lockOrderGraph(tx, { ...ctx, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.paymentStatus !== 'REFUND_DUE') throw new AppError('STATUS_CONFLICT', 'Đơn không ở trạng thái cần hoàn tiền')
    const collected = await tx.select().from(orderPayments).where(and(eq(orderPayments.orgId, ctx.orgId), eq(orderPayments.orderId, order.id), isNull(orderPayments.refundedAt)))
    const linked = await tx.select().from(bankTransactions).where(and(eq(bankTransactions.orgId, ctx.orgId), eq(bankTransactions.matchedOrderId, order.id), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED'), eq(bankTransactions.reviewReason, 'ORDER_CANCELLED')))
    const held = collected.reduce((n, r) => n + r.amountVnd, 0) + linked.reduce((n, r) => n + r.amountVnd, 0)
    if (input.expectedHeldVnd !== held) throw new AppError('STATUS_CONFLICT', 'Số tiền cần hoàn đã thay đổi, vui lòng tải lại')
    const now = new Date()
    await tx.update(orderPayments).set({ refundedAt: now }).where(and(eq(orderPayments.orgId, ctx.orgId), eq(orderPayments.orderId, order.id), isNull(orderPayments.refundedAt)))
    for (const bt of linked) {
      await tx.update(bankTransactions).set({ reconciliationStatus: 'RESOLVED', resolution: 'REFUNDED_OUTSIDE', resolutionNote: input.note, resolvedBy: ctx.userId, resolvedAt: now }).where(eq(bankTransactions.id, bt.id))
      await tx.insert(bankTransactionEvents).values({ orgId: ctx.orgId, bankTransactionId: bt.id, action: 'RESOLVED', fromStatus: 'REVIEW_REQUIRED', toStatus: 'RESOLVED', orderId: order.id, actorUserId: ctx.userId, metadata: { resolution: 'REFUNDED_OUTSIDE' } })
    }
    await tx.update(orders).set({ paymentStatus: 'REFUNDED' }).where(eq(orders.id, order.id))
    await tx.insert(orderEvents).values({ orgId: ctx.orgId, storeId: ctx.storeId, orderId: order.id, actorUserId: ctx.userId, eventType: 'PAYMENT_REFUNDED', metadata: { note: input.note, amountVnd: held } })
  })
}

export async function listOverdueOrders(db: Db, scope: StoreScope): Promise<OverdueOrder[]> {
  const rows = await db.select({
    id: orders.id,
    publicCode: orders.publicCode,
    totalVnd: orders.totalVnd,
    paymentStatus: orders.paymentStatus,
    createdAt: orders.createdAt,
  }).from(orders).where(overdueWhere(scope)).orderBy(asc(orders.createdAt)).limit(100)
  return rows.map(row => ({
    id: row.id,
    publicCode: row.publicCode,
    totalVnd: row.totalVnd,
    paymentStatus: row.paymentStatus as OverdueOrder['paymentStatus'],
    createdAt: row.createdAt.toISOString(),
  }))
}

export async function markOrderPaidBankManual(
  db: Db,
  ctx: ActorScope,
  input: { orderId: string, expectedPaymentStatus: 'PENDING' | 'REVIEW_REQUIRED', note: string },
): Promise<{ orderId: string }> {
  if (!uuid.safeParse(input.orderId).success) throw notFound()
  return db.transaction(async (tx) => {
    await lockOrgPayments(tx, ctx.orgId)
    const { attempts, order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: ctx.storeId, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.status !== 'AWAITING_PAYMENT' || order.paymentStatus !== input.expectedPaymentStatus) {
      throw new AppError('STATUS_CONFLICT', 'Trạng thái thanh toán của đơn đã thay đổi')
    }
    await confirmOrderPayment(tx, {
      order,
      method: 'BANK_MANUAL',
      amountVnd: order.totalVnd,
      bankTransactionId: null,
      paymentCodeAttemptId: null,
      actorUserId: ctx.userId,
      late: !attempts.some(a => a.status === 'PENDING'),
      eventType: 'PAYMENT_MANUAL_BANK',
      note: input.note,
      metadata: { note: input.note },
    })
    return { orderId: order.id }
  })
}

export async function getReconciliationSummary(db: Db, scope: StoreScope): Promise<ReconciliationSummary> {
  const [review] = await db.select({ n: sql<number>`count(*)::int` }).from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, scope.orgId), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED')))
  const [refund] = await db.select({ n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.paymentStatus, 'REFUND_DUE')))
  const [overdue] = await db.select({ n: sql<number>`count(*)::int` }).from(orders).where(overdueWhere(scope))
  return { reviewCount: review!.n, refundDueCount: refund!.n, overdueCount: overdue!.n }
}
