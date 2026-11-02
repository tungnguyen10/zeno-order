import { addToDraft, draftTotals, type DraftLine } from '#shared/cart-draft'
import type { PublicProduct } from '#shared/types/catalog'

export function useCartDraft(slug: MaybeRefOrGetter<string>) {
  const drafts = useState<Record<string, DraftLine[]>>('cart-draft-by-store', () => ({}))
  const lines = computed(() => drafts.value[toValue(slug)] ?? [])
  const totals = computed(() => draftTotals(lines.value))

  function add(product: PublicProduct, valueIds: string[], quantity: number) {
    const currentSlug = toValue(slug)
    drafts.value = {
      ...drafts.value,
      [currentSlug]: addToDraft(drafts.value[currentSlug] ?? [], product, valueIds, quantity),
    }
  }

  return { lines, totals, add }
}
