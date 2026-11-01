import { and, eq } from 'drizzle-orm'
import type { UpdateFulfillmentInput } from '#shared/schemas/fulfillment'
import type { StoreDetail } from '#shared/types/identity'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { stores } from '../../db/schema'
import { AppError } from '../../utils/errors'
import { getStoreDetail } from '../store/settings'

const AT_LEAST_ONE = 'Cần bật ít nhất một hình thức nhận món'

export async function updateFulfillment(db: Db, ctx: StoreContext, patch: UpdateFulfillmentInput): Promise<StoreDetail> {
  return db.transaction(async (tx) => {
    const scope = and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))
    const [current] = await tx.select({ dineIn: stores.dineInEnabled, pickup: stores.pickupEnabled, delivery: stores.deliveryEnabled })
      .from(stores).where(scope).limit(1).for('update')
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    const next = {
      dineIn: patch.dineInEnabled ?? current.dineIn,
      pickup: patch.pickupEnabled ?? current.pickup,
      delivery: patch.deliveryEnabled ?? current.delivery,
    }
    if (!next.dineIn && !next.pickup && !next.delivery) throw new AppError('VALIDATION_FAILED', AT_LEAST_ONE, [{ path: 'modes', message: AT_LEAST_ONE }])
    await tx.update(stores).set({ dineInEnabled: next.dineIn, pickupEnabled: next.pickup, deliveryEnabled: next.delivery, updatedAt: new Date() }).where(scope)
    return getStoreDetail(tx, ctx)
  })
}
