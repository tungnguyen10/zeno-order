import { addToDraft, draftTotals, type DraftLine } from '#shared/cart-draft'
import type { PublicProduct } from '#shared/types/catalog'

export function useCartDraft(slug: MaybeRefOrGetter<string>) {
  const lines = useState<DraftLine[]>(`cart-draft:${toValue(slug)}`, () => [])
  const totals = computed(() => draftTotals(lines.value))

  function add(product: PublicProduct, valueIds: string[], quantity: number) {
    lines.value = addToDraft(lines.value, product, valueIds, quantity)
  }

  return { lines, totals, add }
}
