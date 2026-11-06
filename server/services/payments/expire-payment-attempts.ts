import { and, eq, lte, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { orderEvents, orders, paymentAttempts } from '../../db/schema'
import { lockOrderGraph } from './lock-order-graph'
import { lockOrgPayments } from './payment-lock'

/** Recheck all eligibility under the same order lock QR replacement uses. */
export async function cancelOrderIfStillUnpaid(db: Db, ref: { id: string, orgId: string, storeId: string }, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockOrgPayments(tx, ref.orgId)
    const { order } = await lockOrderGraph(tx, { orgId: ref.orgId, storeId: ref.storeId, orderId: ref.id })
    if (!order || order.status !== 'AWAITING_PAYMENT' || order.paymentStatus !== 'PENDING' || order.createdAt.getTime() >= now.getTime() - 86_400_000) return false
    const updated = await tx.update(orders).set({ status: 'CANCELLED', paymentStatus: 'UNPAID' }).where(and(
      eq(orders.id, ref.id), eq(orders.orgId, ref.orgId), eq(orders.storeId, ref.storeId),
      eq(orders.status, 'AWAITING_PAYMENT'), eq(orders.paymentStatus, 'PENDING'),
      sql`exists (select 1 from payment_attempts a where a.order_id = ${ref.id})`,
      sql`not exists (select 1 from payment_attempts a where a.order_id = ${ref.id} and a.status = 'PENDING')`,
      sql`not exists (select 1 from bank_transactions b join payment_attempts a on a.payment_code = b.payment_code where a.order_id = ${ref.id} and b.org_id = ${ref.orgId} and b.reconciliation_status in ('RECEIVED', 'REVIEW_REQUIRED'))`,
      // Every attempt needs a live provider whose contiguous successful scan covers its entire life,
      // through a recent settled window. Current link removal cannot imply successful reconciliation.
      sql`not exists (
        select 1 from payment_attempts a where a.order_id = ${ref.id} and not exists (
          select 1 from integration_accounts ia join sepay_integrations i on i.id = ia.integration_id
          join reconcile_checkpoints c on c.integration_id = i.id
          where ia.payment_account_id = a.account_id and i.org_id = ${ref.orgId}
          and i.environment = 'live' and i.status = 'ACTIVE' and i.encrypted_api_token is not null
          and c.last_error is null and c.covered_from <= a.created_at and c.last_synced_at > a.expires_at
          and c.last_synced_at >= ${new Date(now.getTime() - 20 * 60_000).toISOString()}::timestamptz
        )
      )`,
    )).returning({ id: orders.id })
    if (!updated.length) return false
    await tx.insert(orderEvents).values({ orgId: ref.orgId, storeId: ref.storeId, orderId: ref.id, actorUserId: null,
      eventType: 'AUTO_CANCELLED_UNPAID', fromState: 'AWAITING_PAYMENT', toState: 'CANCELLED', metadata: { reason: 'PAYMENT_TIMEOUT' } })
    return true
  })
}

export async function cancelStaleAwaitingOrders(db: Db, now: Date): Promise<number> {
  const candidates = await db.select({ id: orders.id, orgId: orders.orgId, storeId: orders.storeId }).from(orders)
    .where(and(eq(orders.status, 'AWAITING_PAYMENT'), eq(orders.paymentStatus, 'PENDING'), lte(orders.createdAt, new Date(now.getTime() - 86_400_000)))).limit(100)
  let cancelled = 0
  for (const row of candidates) if (await cancelOrderIfStillUnpaid(db, row, now)) cancelled++
  return cancelled
}

export async function expirePaymentAttempts(db: Db, now: Date): Promise<{ expiredAttempts: number, cancelledOrders: number }> {
  const expired = await db.update(paymentAttempts).set({ status: 'EXPIRED' })
    .where(and(eq(paymentAttempts.status, 'PENDING'), lte(paymentAttempts.expiresAt, now))).returning({ id: paymentAttempts.id })
  return { expiredAttempts: expired.length, cancelledOrders: await cancelStaleAwaitingOrders(db, now) }
}
