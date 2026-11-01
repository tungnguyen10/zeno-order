import { and, asc, count, eq, inArray, isNull, or, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { DbOrTx } from '../db/client'
import { categories, deliveryZones, productOptionGroups, productOptionValues, products } from '../db/schema'

export interface CatalogScope {
  orgId: string
  storeId: string
}

export function inStore(table: { orgId: AnyPgColumn, storeId: AnyPgColumn }, scope: CatalogScope): SQL | undefined {
  return and(eq(table.orgId, scope.orgId), eq(table.storeId, scope.storeId))
}

export async function listCategoryRows(db: DbOrTx, scope: CatalogScope, opts: { activeOnly?: boolean } = {}) {
  return db
    .select()
    .from(categories)
    .where(and(inStore(categories, scope), opts.activeOnly ? eq(categories.active, true) : undefined))
    .orderBy(asc(categories.position), asc(categories.createdAt), asc(categories.id))
}

export async function listProductRows(db: DbOrTx, scope: CatalogScope, opts: { publicOnly?: boolean, productId?: string } = {}) {
  const rows = await db
    .select({ product: products })
    .from(products)
    .leftJoin(categories, and(eq(categories.orgId, products.orgId), eq(categories.storeId, products.storeId), eq(categories.id, products.categoryId)))
    .where(and(
      inStore(products, scope),
      opts.productId ? eq(products.id, opts.productId) : undefined,
      opts.publicOnly ? and(eq(products.active, true), or(isNull(products.categoryId), eq(categories.active, true))) : undefined,
    ))
    .orderBy(asc(products.position), asc(products.createdAt), asc(products.id))
  return rows.map(row => row.product)
}

export async function listOptionGroupRows(db: DbOrTx, scope: CatalogScope, productIds: string[]) {
  if (productIds.length === 0) return []
  return db
    .select()
    .from(productOptionGroups)
    .where(and(inStore(productOptionGroups, scope), inArray(productOptionGroups.productId, productIds)))
    .orderBy(asc(productOptionGroups.position), asc(productOptionGroups.createdAt), asc(productOptionGroups.id))
}

export async function listOptionValueRows(db: DbOrTx, scope: CatalogScope, groupIds: string[]) {
  if (groupIds.length === 0) return []
  return db
    .select()
    .from(productOptionValues)
    .where(and(inStore(productOptionValues, scope), inArray(productOptionValues.groupId, groupIds)))
    .orderBy(asc(productOptionValues.position), asc(productOptionValues.createdAt), asc(productOptionValues.id))
}

export async function countActiveZones(db: DbOrTx, scope: CatalogScope): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(deliveryZones)
    .where(and(inStore(deliveryZones, scope), eq(deliveryZones.active, true)))
  return row?.total ?? 0
}
