import { and, asc, eq } from 'drizzle-orm'
import type { Tx } from '../../db/client'
import { orders, paymentAttempts } from '../../db/schema'

export type PaymentAttemptRow = typeof paymentAttempts.$inferSelect
export type OrderRow = typeof orders.$inferSelect

// Order first, then attempts: identical to PR5 QR replacement. PR6 multi-order writes also
// hold the organization payment mutex before taking any bank/order row locks.
export async function lockOrderGraph(
  tx: Tx,
  scope: { orgId: string, storeId: string, orderId: string },
): Promise<{ attempts: PaymentAttemptRow[], order: OrderRow | null }> {
  const [order] = await tx.select().from(orders)
    .where(and(eq(orders.orgId, scope.orgId), eq(orders.storeId, scope.storeId), eq(orders.id, scope.orderId)))
    .for('update')
  const attempts = await tx.select().from(paymentAttempts)
    .where(and(
      eq(paymentAttempts.orgId, scope.orgId),
      eq(paymentAttempts.storeId, scope.storeId),
      eq(paymentAttempts.orderId, scope.orderId),
    ))
    .orderBy(asc(paymentAttempts.id))
    .for('update')
  return { attempts, order: order ?? null }
}
