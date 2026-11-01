import { and, eq } from 'drizzle-orm'
import type { DbOrTx } from '../db/client'
import { organizations, stores } from '../db/schema'

export interface PublicStoreRow {
  id: string
  orgId: string
  name: string
  slug: string
  isAcceptingOrders: boolean
  dineInEnabled: boolean
  pickupEnabled: boolean
  deliveryEnabled: boolean
  logoKey: string | null
}

const MAX_SLUG_LENGTH = 40

export async function findPublicStoreBySlug(db: DbOrTx, slug: string): Promise<PublicStoreRow | null> {
  const normalized = slug.trim().toLowerCase()
  if (slug.length > MAX_SLUG_LENGTH || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) return null
  const [row] = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      name: stores.name,
      slug: stores.slug,
      isAcceptingOrders: stores.isAcceptingOrders,
      dineInEnabled: stores.dineInEnabled,
      pickupEnabled: stores.pickupEnabled,
      deliveryEnabled: stores.deliveryEnabled,
      logoKey: stores.logoKey,
    })
    .from(stores)
    .innerJoin(organizations, eq(organizations.id, stores.orgId))
    .where(and(eq(stores.slug, normalized), eq(stores.status, 'ACTIVE'), eq(organizations.status, 'ACTIVE')))
    .limit(1)
  return row ?? null
}
