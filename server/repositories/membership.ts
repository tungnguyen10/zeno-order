import { and, asc, eq, isNotNull, or } from 'drizzle-orm'
import type { OrganizationSummary, StoreRole, StoreSummary } from '#shared/types/identity'
import type { DbOrTx } from '../db/client'
import { organizationMembers, organizations, storeMembers, stores } from '../db/schema'

export interface StoreAccess {
  orgId: string
  storeId: string
  role: StoreRole
}

function storeJoins(userId: string) {
  return {
    org: and(
      eq(organizationMembers.orgId, stores.orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
    ),
    store: and(
      eq(storeMembers.storeId, stores.id),
      eq(storeMembers.userId, userId),
      eq(storeMembers.status, 'ACTIVE'),
    ),
  }
}

function effectiveRole(orgRole: string | null, storeRole: StoreRole | null): StoreRole | null {
  return orgRole === 'OWNER' ? 'OWNER' : storeRole
}

export async function findStoreAccess(db: DbOrTx, userId: string, storeId: string): Promise<StoreAccess | null> {
  const joins = storeJoins(userId)
  const [row] = await db
    .select({ storeId: stores.id, orgId: stores.orgId, orgRole: organizationMembers.role, storeRole: storeMembers.role })
    .from(stores)
    .leftJoin(organizationMembers, joins.org)
    .leftJoin(storeMembers, joins.store)
    .where(and(eq(stores.id, storeId), eq(stores.status, 'ACTIVE')))
    .limit(1)
  if (!row) return null
  const role = effectiveRole(row.orgRole, row.storeRole)
  return role ? { orgId: row.orgId, storeId: row.storeId, role } : null
}

export async function findOrgAccess(db: DbOrTx, userId: string, orgId: string): Promise<{ orgId: string, role: 'OWNER' } | null> {
  const [row] = await db
    .select({ orgId: organizationMembers.orgId })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(
      eq(organizationMembers.orgId, orgId),
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
      eq(organizationMembers.role, 'OWNER'),
      eq(organizations.status, 'ACTIVE'),
    ))
    .limit(1)
  return row ? { orgId: row.orgId, role: 'OWNER' } : null
}

export async function listAccessibleStores(db: DbOrTx, userId: string): Promise<StoreSummary[]> {
  const joins = storeJoins(userId)
  const rows = await db
    .select({
      id: stores.id,
      orgId: stores.orgId,
      name: stores.name,
      slug: stores.slug,
      isAcceptingOrders: stores.isAcceptingOrders,
      orgRole: organizationMembers.role,
      storeRole: storeMembers.role,
    })
    .from(stores)
    .leftJoin(organizationMembers, joins.org)
    .leftJoin(storeMembers, joins.store)
    .where(and(
      eq(stores.status, 'ACTIVE'),
      or(isNotNull(organizationMembers.id), isNotNull(storeMembers.id)),
    ))
    .orderBy(asc(stores.createdAt), asc(stores.name))

  return rows.flatMap((row) => {
    const role = effectiveRole(row.orgRole, row.storeRole)
    if (!role) return []
    return [{ id: row.id, orgId: row.orgId, name: row.name, slug: row.slug, isAcceptingOrders: row.isAcceptingOrders, role }]
  })
}

export async function listOwnedOrganizations(db: DbOrTx, userId: string): Promise<OrganizationSummary[]> {
  const rows = await db
    .select({ id: organizations.id, name: organizations.name, slug: organizations.slug })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.orgId))
    .where(and(
      eq(organizationMembers.userId, userId),
      eq(organizationMembers.status, 'ACTIVE'),
      eq(organizationMembers.role, 'OWNER'),
      eq(organizations.status, 'ACTIVE'),
    ))
    .orderBy(asc(organizations.createdAt))
  return rows.map(row => ({ ...row, role: 'OWNER' as const }))
}
