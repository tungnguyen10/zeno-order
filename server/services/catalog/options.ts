import { and, eq } from 'drizzle-orm'
import type { ReplaceOptionsInput } from '#shared/schemas/catalog'
import type { OptionGroupDTO } from '#shared/types/catalog'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { productOptionGroups, productOptionValues, products } from '../../db/schema'
import { inStore } from '../../repositories/catalog'
import { AppError } from '../../utils/errors'
import { loadProductDTOs } from './product-view'

export async function replaceProductOptions(
  db: Db,
  ctx: StoreContext,
  productId: string,
  input: ReplaceOptionsInput,
): Promise<OptionGroupDTO[]> {
  return db.transaction(async (tx) => {
    // The row lock serialises concurrent replacements of the same product.
    const [product] = await tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, productId), inStore(products, ctx)))
      .limit(1)
      .for('update')
    if (!product) throw new AppError('NOT_FOUND', 'Không tìm thấy')

    await tx
      .delete(productOptionGroups)
      .where(and(eq(productOptionGroups.productId, productId), inStore(productOptionGroups, ctx)))

    for (const [groupIndex, group] of input.groups.entries()) {
      const [created] = await tx
        .insert(productOptionGroups)
        .values({
          orgId: ctx.orgId,
          storeId: ctx.storeId,
          productId,
          name: group.name,
          required: group.required,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          position: groupIndex,
        })
        .returning({ id: productOptionGroups.id })
      await tx.insert(productOptionValues).values(group.values.map((value, valueIndex) => ({
        orgId: ctx.orgId,
        storeId: ctx.storeId,
        groupId: created!.id,
        name: value.name,
        priceDeltaVnd: value.priceDeltaVnd,
        active: value.active,
        position: valueIndex,
      })))
    }

    // Read while holding the lock so each caller receives its own replacement.
    const [dto] = await loadProductDTOs(tx, ctx, { productId })
    return dto!.optionGroups
  })
}
