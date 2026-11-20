import { and, eq } from 'drizzle-orm'
import type { PushSubscriptionInput } from '#shared/schemas/push'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { pushSubscriptions } from '../../db/schema'

export async function saveSubscription(db: DbOrTx, ctx: StoreContext, input: PushSubscriptionInput): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ orgId: ctx.orgId, storeId: ctx.storeId, userId: ctx.userId, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { orgId: ctx.orgId, storeId: ctx.storeId, userId: ctx.userId, p256dh: input.keys.p256dh, auth: input.keys.auth, updatedAt: new Date() },
    })
}

export async function removeSubscription(db: DbOrTx, ctx: StoreContext, endpoint: string): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.orgId, ctx.orgId), eq(pushSubscriptions.storeId, ctx.storeId)))
}

export async function listStoreSubscriptions(db: DbOrTx, scope: { orgId: string, storeId: string }) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.orgId, scope.orgId), eq(pushSubscriptions.storeId, scope.storeId)))
}
