import { and, eq, max } from 'drizzle-orm'
import type { CreateCategoryInput, UpdateCategoryInput } from '#shared/schemas/catalog'
import type { CategoryDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { DbOrTx } from '../../db/client'
import { categories } from '../../db/schema'
import { inStore, listCategoryRows, type CatalogScope } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'

function toDTO(row: typeof categories.$inferSelect): CategoryDTO {
  return { id: row.id, name: row.name, position: row.position, active: row.active }
}

export async function listCategories(db: DbOrTx, scope: CatalogScope): Promise<CategoryDTO[]> {
  return (await listCategoryRows(db, scope)).map(toDTO)
}

export async function createCategory(db: DbOrTx, ctx: StoreContext, input: CreateCategoryInput): Promise<CategoryDTO> {
  const [last] = await db.select({ top: max(categories.position) }).from(categories).where(inStore(categories, ctx))
  const [row] = await db
    .insert(categories)
    .values({ orgId: ctx.orgId, storeId: ctx.storeId, name: input.name, position: (last?.top ?? -1) + 1 })
    .returning()
  return toDTO(row!)
}

export async function updateCategory(db: DbOrTx, ctx: StoreContext, categoryId: string, patch: UpdateCategoryInput): Promise<CategoryDTO> {
  const [row] = await db
    .update(categories)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(categories.id, categoryId), inStore(categories, ctx)))
    .returning()
  if (!row) throw new AppError('NOT_FOUND', 'Không tìm thấy')
  return toDTO(row)
}
