import { and, eq, inArray, ne } from 'drizzle-orm'
import type { Tx } from '../../db/client'
import { orderEvents, orderPayments, orders, paymentAttempts } from '../../db/schema'

export interface ConfirmArgs {
  order: { id: string, orgId: string, storeId: string }
  method: 'SEPAY' | 'BANK_MANUAL'
  amountVnd: number
  bankTransactionId: string | null
  paymentCodeAttemptId: string | null
  actorUserId: string | null
  late: boolean
  eventType: 'PAYMENT_CONFIRMED' | 'PAYMENT_ASSIGNED' | 'PAYMENT_MANUAL_BANK'
  note: string | null
  metadata: Record<string, unknown>
}

// The only place that turns an AWAITING_PAYMENT order into NEW/PAID. Callers must already hold lockOrderGraph().
export async function confirmOrderPayment(tx: Tx, args: ConfirmArgs): Promise<void> {
  const { order } = args
  const updated = await tx.update(orders)
    .set({ status: 'NEW', paymentStatus: 'PAID', latePayment: args.late })
    .where(and(
      eq(orders.id, order.id),
      eq(orders.orgId, order.orgId),
      eq(orders.storeId, order.storeId),
      eq(orders.status, 'AWAITING_PAYMENT'),
      inArray(orders.paymentStatus, ['PENDING', 'REVIEW_REQUIRED']),
    ))
    .returning({ id: orders.id })
  if (updated.length !== 1) throw new Error('Order is not payable at confirmation time')

  await tx.insert(orderPayments).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    bankTransactionId: args.bankTransactionId,
    method: args.method,
    amountVnd: args.amountVnd,
    recordedBy: args.actorUserId,
    note: args.note,
  })

  if (args.paymentCodeAttemptId) {
    await tx.update(paymentAttempts).set({ status: 'PAID' }).where(eq(paymentAttempts.id, args.paymentCodeAttemptId))
  }
  await tx.update(paymentAttempts).set({ status: 'SUPERSEDED' }).where(and(
    eq(paymentAttempts.orderId, order.id),
    eq(paymentAttempts.status, 'PENDING'),
    args.paymentCodeAttemptId ? ne(paymentAttempts.id, args.paymentCodeAttemptId) : undefined,
  ))

  await tx.insert(orderEvents).values({
    orgId: order.orgId,
    storeId: order.storeId,
    orderId: order.id,
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    fromState: 'AWAITING_PAYMENT',
    toState: 'NEW',
    metadata: { ...args.metadata, method: args.method, amountVnd: args.amountVnd, late: args.late },
  })
}
