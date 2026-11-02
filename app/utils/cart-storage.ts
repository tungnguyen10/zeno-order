import { z } from 'zod'
import { assertVnd } from '#shared/money'
import { MAX_LINE_QUANTITY, priceLine, selectionDeltas, toOptionRules, validateSelection, type OptionGroupRule } from '#shared/pricing'
import { CHECKOUT_LIMITS } from '#shared/schemas/checkout'
import type { PublicProduct } from '#shared/types/catalog'
import type { CartStaleLine, CartStaleReason } from '#shared/types/order'

export interface CartLine {
  lineId: string
  productId: string
  name: string
  optionValueIds: string[]
  optionLabels: string[]
  unitPriceVnd: number
  quantity: number
  note: string
  stale: CartStaleReason | null
  currentUnitPriceVnd: number | null
}

export type NewCartLine = Omit<CartLine, 'lineId' | 'stale' | 'currentUnitPriceVnd'>

export interface CartState {
  version: 1
  lines: CartLine[]
  /** Set when the customer taps "Đặt món"; reused for retries of the same payload, dropped on success. */
  pendingIdempotencyKey: string | null
  pendingFingerprint: string | null
  /** Last non-table mode; dine-in is never remembered (it needs a valid ?t= each visit). */
  fulfillmentType: 'PICKUP' | 'DELIVERY' | null
  customer: { name: string, phone: string, address: string }
  deliveryZoneId: string | null
  note: string
}

export type CartFormPatch = Partial<Pick<CartState, 'fulfillmentType' | 'customer' | 'deliveryZoneId' | 'note'>>

const staleReason = z.enum(['PRODUCT_UNAVAILABLE', 'OPTION_INVALID', 'PRICE_CHANGED'])
const vnd = z.number().int().nonnegative()

const lineSchema = z.object({
  lineId: z.string().min(1).max(64),
  productId: z.string().min(1).max(64),
  name: z.string().max(200),
  optionValueIds: z.array(z.string().max(64)).max(30),
  optionLabels: z.array(z.string().max(200)).max(30),
  unitPriceVnd: vnd,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  note: z.string().max(CHECKOUT_LIMITS.maxNote),
  stale: staleReason.nullable(),
  currentUnitPriceVnd: vnd.nullable(),
})

const cartSchema = z.object({
  version: z.literal(1),
  lines: z.array(lineSchema).max(CHECKOUT_LIMITS.maxLines),
  pendingIdempotencyKey: z.string().max(64).nullable(),
  pendingFingerprint: z.string().max(60_000).nullable(),
  fulfillmentType: z.enum(['PICKUP', 'DELIVERY']).nullable(),
  customer: z.object({
    name: z.string().max(CHECKOUT_LIMITS.maxName),
    phone: z.string().max(24),
    address: z.string().max(CHECKOUT_LIMITS.maxAddress),
  }),
  deliveryZoneId: z.string().max(64).nullable(),
  note: z.string().max(CHECKOUT_LIMITS.maxNote),
})

export function emptyCart(): CartState {
  return {
    version: 1,
    lines: [],
    pendingIdempotencyKey: null,
    pendingFingerprint: null,
    fulfillmentType: null,
    customer: { name: '', phone: '', address: '' },
    deliveryZoneId: null,
    note: '',
  }
}

export function parseStoredCart(raw: string | null): CartState {
  if (!raw) return emptyCart()
  try {
    const parsed = cartSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) return emptyCart()
    cartSubtotal(parsed.data)
    return parsed.data
  }
  catch {
    return emptyCart()
  }
}

export function serializeCart(state: CartState): string {
  return JSON.stringify(state)
}

const lineKey = (line: { productId: string, optionValueIds: string[], note: string }) =>
  JSON.stringify([line.productId, [...line.optionValueIds].sort(), line.note.trim()])

export function isCartFull(state: CartState): boolean {
  return state.lines.length >= CHECKOUT_LIMITS.maxLines
}

export function addLine(state: CartState, input: NewCartLine, newId: () => string): CartState {
  if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) throw new RangeError('Invalid quantity')
  assertVnd(input.unitPriceVnd * Math.min(input.quantity, MAX_LINE_QUANTITY))
  const existing = state.lines.find(line => lineKey(line) === lineKey(input))
  if (existing) {
    return {
      ...state,
      lines: state.lines.map(line => line.lineId === existing.lineId
        ? { ...line, quantity: Math.min(line.quantity + input.quantity, MAX_LINE_QUANTITY), unitPriceVnd: input.unitPriceVnd, stale: null, currentUnitPriceVnd: null }
        : line),
    }
  }
  if (isCartFull(state)) return state
  const line: CartLine = { ...input, quantity: Math.min(input.quantity, MAX_LINE_QUANTITY), lineId: newId(), stale: null, currentUnitPriceVnd: null }
  return { ...state, lines: [...state.lines, line] }
}

export function removeLine(state: CartState, lineId: string): CartState {
  return { ...state, lines: state.lines.filter(line => line.lineId !== lineId) }
}

export function setQuantity(state: CartState, lineId: string, quantity: number): CartState {
  if (!Number.isFinite(quantity) || (quantity > 0 && quantity < 1)) throw new RangeError('Invalid quantity')
  if (quantity <= 0) return removeLine(state, lineId)
  const next = Math.min(Math.floor(quantity), MAX_LINE_QUANTITY)
  return { ...state, lines: state.lines.map(line => (line.lineId === lineId ? { ...line, quantity: next } : line)) }
}

export function markStale(state: CartState, stale: CartStaleLine[]): CartState {
  const byIndex = new Map(stale.map(entry => [entry.index, entry]))
  return {
    ...state,
    lines: state.lines.map((line, index) => {
      const hit = byIndex.get(index)
      return hit && hit.productId === line.productId ? { ...line, stale: hit.reason, currentUnitPriceVnd: hit.currentUnitPriceVnd } : line
    }),
  }
}

export function acceptCurrentPrice(state: CartState, lineId: string): CartState {
  return {
    ...state,
    lines: state.lines.map(line => line.lineId === lineId && line.stale === 'PRICE_CHANGED' && line.currentUnitPriceVnd !== null
      ? { ...line, unitPriceVnd: line.currentUnitPriceVnd, stale: null, currentUnitPriceVnd: null }
      : line),
  }
}

function unitPrice(product: PublicProduct, rules: OptionGroupRule[], valueIds: string[]): number {
  return priceLine({ basePriceVnd: product.basePriceVnd, deltasVnd: selectionDeltas(rules, valueIds), quantity: 1 }).unitPriceVnd
}

function reconcileLine(line: CartLine, product: PublicProduct | undefined): CartLine {
  const fresh: CartLine = { ...line, stale: null, currentUnitPriceVnd: null }
  if (!product || !product.isAvailable) return { ...fresh, stale: 'PRODUCT_UNAVAILABLE' }
  const rules = toOptionRules(product.optionGroups)
  const selection = validateSelection(rules, line.optionValueIds)
  if (!selection.ok) return { ...fresh, stale: 'OPTION_INVALID' }
  const current = unitPrice(product, rules, selection.valueIds)
  return current === line.unitPriceVnd ? fresh : { ...fresh, stale: 'PRICE_CHANGED', currentUnitPriceVnd: current }
}

/** Flags lines the freshly loaded menu no longer supports; heals lines that became valid again. */
export function reconcileWithMenu(state: CartState, products: PublicProduct[]): CartState {
  const byId = new Map(products.map(product => [product.id, product]))
  return { ...state, lines: state.lines.map(line => reconcileLine(line, byId.get(line.productId))) }
}

export function newLineFromProduct(
  product: PublicProduct,
  selection: { optionValueIds: string[], quantity: number, note?: string },
): NewCartLine {
  const rules = toOptionRules(product.optionGroups)
  const validated = validateSelection(rules, selection.optionValueIds)
  if (!validated.ok) throw new RangeError(`Invalid selection: ${validated.reason}`)
  if (!Number.isSafeInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > MAX_LINE_QUANTITY) throw new RangeError('Invalid quantity')
  const names = new Map(product.optionGroups.flatMap(group => group.values.map(value => [value.id, value.name] as const)))
  return {
    productId: product.id,
    name: product.name,
    optionValueIds: selection.optionValueIds,
    optionLabels: selection.optionValueIds.map(id => names.get(id) ?? ''),
    unitPriceVnd: unitPrice(product, rules, selection.optionValueIds),
    quantity: selection.quantity,
    note: (selection.note ?? '').trim(),
  }
}

export function updateForm(state: CartState, patch: CartFormPatch): CartState {
  return { ...state, ...patch }
}

export function ensureIdempotency(state: CartState, fingerprint: string, newKey: () => string): { state: CartState, key: string } {
  if (state.pendingIdempotencyKey && state.pendingFingerprint === fingerprint) {
    return { state, key: state.pendingIdempotencyKey }
  }
  const key = newKey()
  return { state: { ...state, pendingIdempotencyKey: key, pendingFingerprint: fingerprint }, key }
}

export function clearAfterSuccess(state: CartState): CartState {
  return { ...emptyCart(), fulfillmentType: state.fulfillmentType, customer: state.customer, deliveryZoneId: state.deliveryZoneId }
}

export const cartCount = (state: CartState): number => state.lines.reduce((sum, line) => sum + line.quantity, 0)
export const cartSubtotal = (state: CartState): number => state.lines.reduce((sum, line) => assertVnd(sum + assertVnd(line.unitPriceVnd * line.quantity)), 0)
export const hasStaleLines = (state: CartState): boolean => state.lines.some(line => line.stale !== null)
