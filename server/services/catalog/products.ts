import { and, eq, max } from 'drizzle-orm'
import type { CreateProductInput, UpdateProductInput } from '#shared/schemas/catalog'
import type { ProductDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { categories, products } from '../../db/schema'
import { inStore, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { loadProductDTOs } from './product-view'

const notFound = () => new AppError('NOT_FOUND', 'Không tìm thấy')

async function assertCategoryInStore(db: DbOrTx, scope: CatalogScope, categoryId: string): Promise<void> {
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, categoryId), inStore(categories, scope)))
    .limit(1)
  if (!row) throw notFound()
}

export async function listProducts(db: DbOrTx, scope: CatalogScope): Promise<ProductDTO[]> {
  return loadProductDTOs(db, scope)
}

export async function createProduct(db: DbOrTx, ctx: StoreContext, input: CreateProductInput): Promise<ProductDTO> {
  if (input.categoryId) await assertCategoryInStore(db, ctx, input.categoryId)
  const [last] = await db.select({ top: max(products.position) }).from(products).where(inStore(products, ctx))
  const [row] = await db
    .insert(products)
    .values({
      orgId: ctx.orgId,
      storeId: ctx.storeId,
      categoryId: input.categoryId ?? null,
      name: input.name,
      description: input.description ? input.description : null,
      basePriceVnd: input.basePriceVnd,
      position: (last?.top ?? -1) + 1,
    })
    .returning({ id: products.id })
  const [dto] = await loadProductDTOs(db, ctx, { productId: row!.id })
  return dto!
}

export async function updateProduct(db: DbOrTx, ctx: StoreContext, productId: string, patch: UpdateProductInput): Promise<ProductDTO> {
  if (patch.categoryId) await assertCategoryInStore(db, ctx, patch.categoryId)

  const set: Partial<typeof products.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) set.name = patch.name
  if (patch.basePriceVnd !== undefined) set.basePriceVnd = patch.basePriceVnd
  if (patch.categoryId !== undefined) set.categoryId = patch.categoryId
  if (patch.description !== undefined) set.description = patch.description ? patch.description : null
  if (patch.isAvailable !== undefined) set.isAvailable = patch.isAvailable
  if (patch.active !== undefined) set.active = patch.active
  if (patch.position !== undefined) set.position = patch.position

  const [row] = await db
    .update(products)
    .set(set)
    .where(and(eq(products.id, productId), inStore(products, ctx)))
    .returning({ id: products.id })
  if (!row) throw notFound()
  const [dto] = await loadProductDTOs(db, ctx, { productId })
  return dto!
}
