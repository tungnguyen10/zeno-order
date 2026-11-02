import { and, eq } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { categories, productOptionGroups, productOptionValues, products, stores } from '../../db/schema'
import { AppError } from '../../utils/errors'

export async function seedCatalog(db: Db, storeId: string): Promise<{ created: boolean }> {
  return db.transaction(async (tx) => {
    const [store] = await tx.select().from(stores).where(eq(stores.id, storeId)).for('update').limit(1)
    if (!store) throw new AppError('NOT_FOUND', 'Không tìm thấy cửa hàng')

    const scope = { orgId: store.orgId, storeId: store.id }
    const [existing] = await tx.select({ id: categories.id })
      .from(categories)
      .where(and(
        eq(categories.orgId, scope.orgId),
        eq(categories.storeId, scope.storeId),
        eq(categories.name, 'Menu mẫu ZENO'),
      ))
      .limit(1)
    if (existing) return { created: false }

    const [category] = await tx.insert(categories)
      .values({ ...scope, name: 'Menu mẫu ZENO', position: 0 })
      .returning()
    await tx.insert(products)
      .values({ ...scope, categoryId: category!.id, name: 'Cà phê sữa', basePriceVnd: 25000, position: 0 })
    const [tea] = await tx.insert(products)
      .values({ ...scope, categoryId: category!.id, name: 'Trà sữa', basePriceVnd: 35000, position: 1 })
      .returning()
    const [group] = await tx.insert(productOptionGroups)
      .values({ ...scope, productId: tea!.id, name: 'Size', required: true, minSelect: 1, maxSelect: 1, position: 0 })
      .returning()
    await tx.insert(productOptionValues).values([
      { ...scope, groupId: group!.id, name: 'M', priceDeltaVnd: 0, position: 0 },
      { ...scope, groupId: group!.id, name: 'L', priceDeltaVnd: 5000, position: 1 },
    ])

    return { created: true }
  })
}
