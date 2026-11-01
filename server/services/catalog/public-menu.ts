import type { PublicMenu } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { countActiveZones, listCategoryRows } from '../../repositories/catalog'
import { findPublicStoreBySlug } from '../../repositories/public-store'
import { AppError } from '../../utils/errors'
import { buildModes } from './modes'
import { imageUrlFor, loadProductDTOs, toPublicProduct } from './product-view'

export async function getPublicMenu(db: DbOrTx, slug: string): Promise<PublicMenu> {
  const store = await findPublicStoreBySlug(db, slug)
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  const scope = { orgId: store.orgId, storeId: store.id }

  const [categoryRows, productDTOs, zoneCount] = await Promise.all([
    listCategoryRows(db, scope, { activeOnly: true }),
    loadProductDTOs(db, scope, { publicOnly: true }),
    countActiveZones(db, scope),
  ])

  return {
    store: { name: store.name, slug: store.slug, isAcceptingOrders: store.isAcceptingOrders, logoUrl: imageUrlFor(store.logoKey) },
    modes: buildModes(store, zoneCount),
    categories: categoryRows.map(row => ({ id: row.id, name: row.name })),
    products: productDTOs.map(toPublicProduct),
  }
}
