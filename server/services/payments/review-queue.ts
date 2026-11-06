import { lockOrgPayments } from './payment-lock'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Resolution } from '../../../shared/payments'
import type { OrderBrief, ReviewItem } from '../../../shared/types/reconciliation'
import type { Db, Tx } from '../../db/client'
import { bankTransactionEvents, bankTransactions, sepayIntegrations, orderEvents, orderPayments, orders } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { confirmOrderPayment } from './confirm-payment'
import { lockOrderGraph } from './lock-order-graph'

const PAYABLE_STATUSES = ['PENDING', 'REVIEW_REQUIRED']
const uuid = z.uuid()

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

const briefColumns = {
  id: orders.id,
  storeId: orders.storeId,
  publicCode: orders.publicCode,
  status: orders.status,
  paymentStatus: orders.paymentStatus,
  totalVnd: orders.totalVnd,
}

const isPayable = (order: OrderBrief) => order.status === 'AWAITING_PAYMENT' && PAYABLE_STATUSES.includes(order.paymentStatus)

export async function listReviewItems(
  db: Db,
  ctx: { orgId: string },
  status: 'REVIEW_REQUIRED' | 'RESOLVED',
): Promise<ReviewItem[]> {
  const rows = await db.select().from(bankTransactions)
    .where(and(eq(bankTransactions.orgId, ctx.orgId), eq(bankTransactions.reconciliationStatus, status)))
    .orderBy(desc(bankTransactions.receivedAt))
    .limit(status === 'REVIEW_REQUIRED' ? 100 : 30)
  if (rows.length === 0) return []

  const matchedIds = [...new Set(rows.flatMap(row => (row.matchedOrderId ? [row.matchedOrderId] : [])))]
  const matched = matchedIds.length === 0
    ? []
    : await db.select(briefColumns).from(orders).where(and(eq(orders.orgId, ctx.orgId), inArray(orders.id, matchedIds)))
  const matchedById = new Map(matched.map(order => [order.id, order as OrderBrief]))

  const candidates: OrderBrief[] = status === 'REVIEW_REQUIRED'
    ? await db.select(briefColumns).from(orders)
      .where(and(
        eq(orders.orgId, ctx.orgId),
        eq(orders.status, 'AWAITING_PAYMENT'),
        inArray(orders.paymentStatus, PAYABLE_STATUSES as ('PENDING' | 'REVIEW_REQUIRED')[]),
      ))
      .orderBy(desc(orders.createdAt))
      .limit(200)
    : []

  return rows.map((row) => {
    const matchedOrder = row.matchedOrderId ? (matchedById.get(row.matchedOrderId) ?? null) : null
    const suggestions: OrderBrief[] = []
    if (matchedOrder && isPayable(matchedOrder)) suggestions.push(matchedOrder)
    for (const order of candidates) {
      if (order.totalVnd === row.amountVnd && !suggestions.some(s => s.id === order.id)) suggestions.push(order)
    }
    return {
      id: row.id,
      status: row.reconciliationStatus,
      reason: row.reviewReason,
      amountVnd: row.amountVnd,
      accountLast4: row.bankAccountNumber.slice(-4),
      content: row.content,
      referenceCode: row.referenceCode,
      source: row.source,
      transactionDate: row.transactionDate.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      resolution: row.resolution,
      matchedOrder,
      suggestedOrders: suggestions.slice(0, 3),
    }
  })
}

async function lockTransaction(tx: Tx, orgId: string, transactionId: string) {
  if (!uuid.safeParse(transactionId).success) throw notFound()
  const [bt] = await tx.select().from(bankTransactions)
    .where(and(eq(bankTransactions.id, transactionId), eq(bankTransactions.orgId, orgId)))
    .for('update')
  if (!bt) throw notFound()
  return bt
}

// Returns an order that was flagged only because of review items to PENDING once none remain.
async function releaseReviewFlag(tx: Tx, orgId: string, orderId: string): Promise<void> {
  await tx.update(orders).set({ paymentStatus: 'PENDING' }).where(and(
    eq(orders.id, orderId),
    eq(orders.orgId, orgId),
    eq(orders.paymentStatus, 'REVIEW_REQUIRED'),
    sql`not exists (select 1 from bank_transactions b where b.matched_order_id = ${orderId} and b.reconciliation_status = 'REVIEW_REQUIRED')`,
  ))
}

export async function assignTransactionToOrder(
  db: Db,
  ctx: { orgId: string, userId: string },
  input: { transactionId: string, orderId: string, acceptAmountDifference: boolean },
): Promise<{ orderId: string }> {
  return db.transaction(async (tx) => {
    await lockOrgPayments(tx, ctx.orgId)
    const bt = await lockTransaction(tx, ctx.orgId, input.transactionId)
    if (bt.reconciliationStatus !== 'REVIEW_REQUIRED') throw new AppError('STATUS_CONFLICT', 'Giao dịch đã được xử lý')
    const [integration] = await tx.select({ environment: sepayIntegrations.environment }).from(sepayIntegrations).where(eq(sepayIntegrations.id, bt.integrationId))
    if (integration?.environment !== 'live') throw new AppError('STATUS_CONFLICT', 'Không gán tiền thử nghiệm vào đơn thật')
    if (!uuid.safeParse(input.orderId).success) throw notFound()

    const [target] = await tx.select({ storeId: orders.storeId }).from(orders)
      .where(and(eq(orders.id, input.orderId), eq(orders.orgId, ctx.orgId)))
    if (!target) throw notFound()

    const { attempts, order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: target.storeId, orderId: input.orderId })
    if (!order) throw notFound()
    if (order.status !== 'AWAITING_PAYMENT' || !PAYABLE_STATUSES.includes(order.paymentStatus)) {
      throw new AppError('STATUS_CONFLICT', 'Đơn không còn chờ thanh toán')
    }
    if (bt.amountVnd !== order.totalVnd && !input.acceptAmountDifference) {
      throw new AppError('VALIDATION_FAILED', 'Số tiền chuyển khác với giá trị đơn', {
        reason: 'AMOUNT_MISMATCH',
        expectedVnd: order.totalVnd,
        receivedVnd: bt.amountVnd,
      })
    }

    const codeAttempt = attempts.find(a => a.paymentCode === bt.paymentCode && a.status !== 'PAID') ?? null
    await confirmOrderPayment(tx, {
      order,
      method: 'SEPAY',
      amountVnd: bt.amountVnd,
      bankTransactionId: bt.id,
      paymentCodeAttemptId: codeAttempt?.id ?? null,
      actorUserId: ctx.userId,
      late: !attempts.some(a => a.status === 'PENDING'),
      eventType: 'PAYMENT_ASSIGNED',
      note: null,
      metadata: { bankTransactionId: bt.id, amountDifferenceAccepted: bt.amountVnd !== order.totalVnd },
    })
    await tx.update(bankTransactions).set({
      reconciliationStatus: 'MATCHED',
      reviewReason: null,
      matchedStoreId: order.storeId,
      matchedOrderId: order.id,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: ctx.orgId,
      bankTransactionId: bt.id,
      action: 'ASSIGNED',
      fromStatus: 'REVIEW_REQUIRED',
      toStatus: 'MATCHED',
      orderId: order.id,
      actorUserId: ctx.userId,
      metadata: { amountDifferenceAccepted: bt.amountVnd !== order.totalVnd },
    })
    if (bt.matchedOrderId && bt.matchedOrderId !== order.id) await releaseReviewFlag(tx, ctx.orgId, bt.matchedOrderId)
    return { orderId: order.id }
  })
}

export async function resolveTransaction(
  db: Db,
  ctx: { orgId: string, userId: string },
  input: { transactionId: string, resolution: Resolution, note?: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    await lockOrgPayments(tx, ctx.orgId)
    const bt = await lockTransaction(tx, ctx.orgId, input.transactionId)
    if (bt.reconciliationStatus !== 'REVIEW_REQUIRED') throw new AppError('STATUS_CONFLICT', 'Giao dịch đã được xử lý')

    await tx.update(bankTransactions).set({
      reconciliationStatus: 'RESOLVED',
      resolution: input.resolution,
      resolutionNote: input.note ?? null,
      resolvedBy: ctx.userId,
      resolvedAt: new Date(),
    }).where(eq(bankTransactions.id, bt.id))
    await tx.insert(bankTransactionEvents).values({
      orgId: ctx.orgId,
      bankTransactionId: bt.id,
      action: 'RESOLVED',
      fromStatus: 'REVIEW_REQUIRED',
      toStatus: 'RESOLVED',
      orderId: bt.matchedOrderId,
      actorUserId: ctx.userId,
      metadata: { resolution: input.resolution },
    })

    if (!bt.matchedOrderId || !bt.matchedStoreId) return
    const { order } = await lockOrderGraph(tx, { orgId: ctx.orgId, storeId: bt.matchedStoreId, orderId: bt.matchedOrderId })
    if (!order) return

    if (bt.reviewReason === 'ORDER_CANCELLED' && order.paymentStatus === 'REFUND_DUE') {
      const [collected] = await tx.select({ id: orderPayments.id }).from(orderPayments).where(and(eq(orderPayments.orderId, order.id), isNull(orderPayments.refundedAt))).limit(1)
      const [outstanding] = await tx.select({ id: bankTransactions.id }).from(bankTransactions).where(and(eq(bankTransactions.orgId, ctx.orgId), eq(bankTransactions.matchedOrderId, order.id), eq(bankTransactions.reconciliationStatus, 'REVIEW_REQUIRED'), eq(bankTransactions.reviewReason, 'ORDER_CANCELLED'))).limit(1)
      if (!collected && !outstanding) {
        const [priorRefund] = await tx.select({ id: orderPayments.id }).from(orderPayments)
          .where(and(eq(orderPayments.orderId, order.id), sql`${orderPayments.refundedAt} is not null`)).limit(1)
        const [refundedTransfer] = await tx.select({ id: bankTransactions.id }).from(bankTransactions)
          .where(and(eq(bankTransactions.orgId, ctx.orgId), eq(bankTransactions.matchedOrderId, order.id), eq(bankTransactions.resolution, 'REFUNDED_OUTSIDE'))).limit(1)
        const refunded = input.resolution === 'REFUNDED_OUTSIDE' || !!priorRefund || !!refundedTransfer
        await tx.update(orders).set({ paymentStatus: refunded ? 'REFUNDED' : 'UNPAID' }).where(eq(orders.id, order.id))
        await tx.insert(orderEvents).values({ orgId: order.orgId, storeId: order.storeId, orderId: order.id, actorUserId: ctx.userId, eventType: refunded ? 'PAYMENT_REFUNDED' : 'PAYMENT_REVIEW_DISMISSED', metadata: { bankTransactionId: bt.id, resolution: input.resolution } })
      }
      return
    }
    await releaseReviewFlag(tx, ctx.orgId, order.id)
  })
}
