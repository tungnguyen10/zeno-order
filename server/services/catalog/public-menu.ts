import { describeOpenState, evaluateOpen } from '#shared/store-hours'
import type { PublicMenu } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { countActiveZones, listCategoryRows } from '../../repositories/catalog'
import { findPublicStoreBySlug } from '../../repositories/public-store'
import { AppError } from '../../utils/errors'
import { findBankQrReceiver } from '../payments/attempts'
import { buildModes } from './modes'
import { imageUrlFor, loadProductDTOs, toPublicProduct } from './product-view'

export async function getPublicMenu(db: DbOrTx, slug: string): Promise<PublicMenu> {
  const store = await findPublicStoreBySlug(db, slug)
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const scope = { orgId: store.orgId, storeId: store.id }

  const [categoryRows, productDTOs, zoneCount, receiver] = await Promise.all([
    listCategoryRows(db, scope, { activeOnly: true }),
    loadProductDTOs(db, scope, { publicOnly: true }),
    countActiveZones(db, scope),
    findBankQrReceiver(db, scope),
  ])

  const now = new Date()
  const openState = evaluateOpen(store.openingHours, store.pausedUntil, now)

  return {
    bankQrEnabled: receiver !== null,
    store: {
      name: store.name,
      slug: store.slug,
      isAcceptingOrders: store.isAcceptingOrders,
      logoUrl: imageUrlFor(store.logoKey),
      openNow: openState.open,
      closedHint: describeOpenState(openState, now),
      openingHours: store.openingHours ?? null,
      pausedUntil: store.pausedUntil ? store.pausedUntil.toISOString() : null,
    },
    modes: buildModes(store, zoneCount),
    categories: categoryRows.map(row => ({ id: row.id, name: row.name, imageUrl: imageUrlFor(row.imageKey) })),
    products: productDTOs.map(toPublicProduct),
  }
}
