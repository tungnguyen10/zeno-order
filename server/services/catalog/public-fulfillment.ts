import type { PublicFulfillment } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { listZoneRows } from '../../repositories/catalog'
import { findPublicStoreBySlug } from '../../repositories/public-store'
import { AppError } from '../../utils/errors'
import { buildModes } from './modes'
import { resolveActiveTable } from './tables'

export async function getPublicFulfillment(
  db: DbOrTx,
  slug: string,
  token: string | undefined,
): Promise<PublicFulfillment> {
  const store = await findPublicStoreBySlug(db, slug)
  if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy')

  const scope = { orgId: store.orgId, storeId: store.id }
  const zones = await listZoneRows(db, scope, { activeOnly: true })

  let table: PublicFulfillment['table'] = null
  let tableError: PublicFulfillment['tableError'] = null
  if (token !== undefined) {
    const resolved = await resolveActiveTable(db, store.id, token)
    if (resolved) table = { displayName: resolved.displayName }
    else tableError = 'INVALID_TABLE'
  }

  return {
    modes: buildModes(store, zones.length),
    deliveryZones: store.deliveryEnabled ? zones.map(({ id, name, feeVnd }) => ({ id, name, feeVnd })) : [],
    table,
    tableError,
  }
}
