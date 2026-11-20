import { MAX_LINE_QUANTITY, toOptionRules, validateSelection } from '#shared/pricing'
import type { PublicProduct } from '#shared/types/catalog'
import { newLineFromProduct, type NewCartLine } from './cart-storage'
import type { RecentOrderItem } from './recent-orders'

export interface ReorderPlan {
  lines: NewCartLine[]
  /** Number of lines that can be added back to the cart. */
  added: number
  /** Items dropped because the product is gone, unavailable, or its options changed. */
  skipped: number
}

/** Rebuilds cart lines from a past order against the current menu, dropping anything no longer orderable. */
export function planReorder(items: readonly RecentOrderItem[], products: readonly PublicProduct[]): ReorderPlan {
  const byId = new Map(products.map(product => [product.id, product]))
  const lines: NewCartLine[] = []
  let skipped = 0

  for (const item of items) {
    const product = byId.get(item.productId)
    if (!product || !product.isAvailable) {
      skipped++
      continue
    }
    const rules = toOptionRules(product.optionGroups)
    if (!validateSelection(rules, item.optionValueIds).ok) {
      skipped++
      continue
    }
    const quantity = Math.min(Math.max(1, Math.floor(item.quantity)), MAX_LINE_QUANTITY)
    try {
      lines.push(newLineFromProduct(product, { optionValueIds: item.optionValueIds, quantity, note: item.note }))
    }
    catch {
      skipped++
    }
  }

  return { lines, added: lines.length, skipped }
}
