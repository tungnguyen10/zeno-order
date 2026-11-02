import { toValue, type MaybeRefOrGetter } from 'vue'
import type { PublicProduct } from '#shared/types/catalog'
import type { CartStaleLine } from '#shared/types/order'
import {
  acceptCurrentPrice,
  addLine,
  cartCount,
  cartSubtotal,
  clearAfterSuccess,
  emptyCart,
  ensureIdempotency,
  hasStaleLines,
  markStale,
  parseStoredCart,
  reconcileWithMenu,
  removeLine,
  serializeCart,
  setQuantity,
  updateForm,
  type CartFormPatch,
  type CartState,
  type NewCartLine,
} from '../utils/cart-storage'
import { uuidv4 } from '../utils/uuid'

/** Per-store cart. Shared between components through useState; localStorage is the source of truth after mount. */
export function useCart(slug: MaybeRefOrGetter<string>) {
  const storageKey = computed(() => `zeno:cart:${toValue(slug)}`)
  const stores = useState<Record<string, CartState>>('zeno:carts', () => ({}))
  const initialized = useState<Record<string, boolean>>('zeno:carts:ready', () => ({}))
  let mounted = false
  const state = computed({
    get: () => stores.value?.[storageKey.value] ?? emptyCart(),
    set: (next: CartState) => { stores.value[storageKey.value] = next },
  })
  const ready = computed(() => initialized.value?.[storageKey.value] ?? false)

  function initialize() {
    stores.value ??= {}
    initialized.value ??= {}
    if (!stores.value[storageKey.value]) stores.value[storageKey.value] = emptyCart()
    if (mounted && !ready.value) {
      state.value = readStorage()
      initialized.value[storageKey.value] = true
    }
  }
  watch(storageKey, initialize, { immediate: true, flush: 'sync' })

  function readStorage(): CartState {
    try {
      return parseStoredCart(localStorage.getItem(storageKey.value))
    }
    catch {
      return emptyCart()
    }
  }

  function commit(next: CartState) {
    state.value = next
    if (!ready.value) return
    try {
      localStorage.setItem(storageKey.value, serializeCart(next))
    }
    catch {
      // Private mode or quota: the cart keeps working in memory for this visit.
    }
  }

  function onStorage(event: StorageEvent) {
    if (event.key === storageKey.value || event.key === null) state.value = parseStoredCart(event.newValue)
  }

  onMounted(() => {
    mounted = true
    initialize()
    window.addEventListener('storage', onStorage)
  })
  onBeforeUnmount(() => window.removeEventListener('storage', onStorage))

  return {
    ready,
    lines: computed(() => state.value.lines),
    count: computed(() => cartCount(state.value)),
    subtotalVnd: computed(() => cartSubtotal(state.value)),
    hasStale: computed(() => hasStaleLines(state.value)),
    customer: computed(() => state.value.customer),
    fulfillmentType: computed(() => state.value.fulfillmentType),
    deliveryZoneId: computed(() => state.value.deliveryZoneId),
    note: computed(() => state.value.note),

    add: (line: NewCartLine) => commit(addLine(state.value, line, uuidv4)),
    setQuantity: (lineId: string, quantity: number) => commit(setQuantity(state.value, lineId, quantity)),
    remove: (lineId: string) => commit(removeLine(state.value, lineId)),
    acceptPrice: (lineId: string) => commit(acceptCurrentPrice(state.value, lineId)),
    reconcile: (products: PublicProduct[]) => commit(reconcileWithMenu(state.value, products)),
    markStale: (lines: CartStaleLine[]) => commit(markStale(state.value, lines)),
    updateForm: (patch: CartFormPatch) => commit(updateForm(state.value, patch)),
    ensureIdempotencyKey(fingerprint: string): string {
      const result = ensureIdempotency(state.value, fingerprint, uuidv4)
      commit(result.state)
      return result.key
    },
    clearAfterSuccess: () => commit(clearAfterSuccess(state.value)),
  }
}
