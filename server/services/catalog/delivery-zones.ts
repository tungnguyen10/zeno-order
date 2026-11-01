import { and, eq, max } from 'drizzle-orm'
import type { CreateZoneInput, UpdateZoneInput } from '#shared/schemas/fulfillment'
import type { DeliveryZoneDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { deliveryZones } from '../../db/schema'
import { inStore, listZoneRows, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'

function toDTO(row: typeof deliveryZones.$inferSelect): DeliveryZoneDTO {
  return { id: row.id, name: row.name, feeVnd: row.feeVnd, active: row.active, position: row.position }
}
export async function listZones(db: DbOrTx, scope: CatalogScope): Promise<DeliveryZoneDTO[]> {
  return (await listZoneRows(db, scope)).map(toDTO)
}
export async function createZone(db: DbOrTx, ctx: StoreContext, input: CreateZoneInput): Promise<DeliveryZoneDTO> {
  const [last] = await db.select({ top: max(deliveryZones.position) }).from(deliveryZones).where(inStore(deliveryZones, ctx))
  const [row] = await db.insert(deliveryZones).values({ orgId: ctx.orgId, storeId: ctx.storeId, name: input.name, feeVnd: input.feeVnd, position: (last?.top ?? -1) + 1 }).returning()
  return toDTO(row!)
}
export async function updateZone(db: DbOrTx, ctx: StoreContext, zoneId: string, patch: UpdateZoneInput): Promise<DeliveryZoneDTO> {
  const [row] = await db.update(deliveryZones).set({ ...patch, updatedAt: new Date() })
    .where(and(eq(deliveryZones.id, zoneId), inStore(deliveryZones, ctx))).returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDTO(row)
}
