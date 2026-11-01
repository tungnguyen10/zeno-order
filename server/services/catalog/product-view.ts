import type { OptionGroupDTO, OptionValueDTO, ProductDTO, PublicOptionGroup, PublicProduct } from '#shared/types/catalog'
import type { DbOrTx } from '../../db/client'
import { listOptionGroupRows, listOptionValueRows, listProductRows, type CatalogScope } from '../../repositories/catalog'
import { PRODUCT_IMAGES_BUCKET, publicObjectUrl } from '../storage'

export function imageUrlFor(key: string | null): string | null {
  return key ? publicObjectUrl(PRODUCT_IMAGES_BUCKET, key) : null
}

export async function loadProductDTOs(
  db: DbOrTx,
  scope: CatalogScope,
  opts: { publicOnly?: boolean, productId?: string } = {},
): Promise<ProductDTO[]> {
  const productRows = await listProductRows(db, scope, opts)
  const groupRows = await listOptionGroupRows(db, scope, productRows.map(row => row.id))
  const valueRows = await listOptionValueRows(db, scope, groupRows.map(row => row.id))

  const valuesByGroup = new Map<string, OptionValueDTO[]>()
  for (const value of valueRows) {
    const list = valuesByGroup.get(value.groupId) ?? []
    list.push({ id: value.id, name: value.name, priceDeltaVnd: value.priceDeltaVnd, active: value.active, position: value.position })
    valuesByGroup.set(value.groupId, list)
  }

  const groupsByProduct = new Map<string, OptionGroupDTO[]>()
  for (const group of groupRows) {
    const list = groupsByProduct.get(group.productId) ?? []
    list.push({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      position: group.position,
      values: valuesByGroup.get(group.id) ?? [],
    })
    groupsByProduct.set(group.productId, list)
  }

  return productRows.map(row => ({
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    basePriceVnd: row.basePriceVnd,
    isAvailable: row.isAvailable,
    active: row.active,
    position: row.position,
    imageUrl: imageUrlFor(row.imageKey),
    optionGroups: groupsByProduct.get(row.id) ?? [],
  }))
}

export function toPublicProduct(product: ProductDTO): PublicProduct {
  const optionGroups: PublicOptionGroup[] = product.optionGroups
    .map(group => ({
      id: group.id,
      name: group.name,
      required: group.required,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      values: group.values.filter(value => value.active).map(value => ({ id: value.id, name: value.name, priceDeltaVnd: value.priceDeltaVnd })),
    }))
    .filter(group => group.values.length > 0)

  // A required group that can no longer be satisfied makes the product impossible to order.
  const unfulfillable = product.optionGroups.some((group) => {
    const needed = Math.max(group.minSelect, group.required ? 1 : 0)
    return group.maxSelect < needed || group.values.filter(value => value.active).length < needed
  })

  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    description: product.description,
    basePriceVnd: product.basePriceVnd,
    isAvailable: product.isAvailable && !unfulfillable,
    imageUrl: product.imageUrl,
    optionGroups,
  }
}
