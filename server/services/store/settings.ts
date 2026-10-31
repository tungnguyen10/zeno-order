import { and, eq } from 'drizzle-orm'
import type { UpdateStoreInput } from '#shared/schemas/identity'
import type { StoreDetail } from '#shared/types/identity'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { stores } from '../../db/schema'
import { AppError } from '../../utils/errors'

type StoreRow = typeof stores.$inferSelect

function toDetail(row: StoreRow, ctx: StoreContext): StoreDetail {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
    role: ctx.role,
    isAcceptingOrders: row.isAcceptingOrders,
    dineInEnabled: row.dineInEnabled,
    pickupEnabled: row.pickupEnabled,
    deliveryEnabled: row.deliveryEnabled,
  }
}

const scope = (ctx: StoreContext) => and(eq(stores.id, ctx.storeId), eq(stores.orgId, ctx.orgId))

export async function getStoreDetail(db: DbOrTx, ctx: StoreContext): Promise<StoreDetail> {
  const [row] = await db.select().from(stores).where(scope(ctx)).limit(1)
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDetail(row, ctx)
}

export async function updateStore(db: DbOrTx, ctx: StoreContext, patch: UpdateStoreInput): Promise<StoreDetail> {
  const [row] = await db
    .update(stores)
    .set({ ...patch, updatedAt: new Date() })
    .where(scope(ctx))
    .returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDetail(row, ctx)
}
