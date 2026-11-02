import { describe, expect, it } from 'vitest'
import type { PublicProduct } from '#shared/types/catalog'
import {
  acceptCurrentPrice,
  addLine,
  cartCount,
  cartSubtotal,
  clearAfterSuccess,
  emptyCart,
  ensureIdempotency,
  hasStaleLines,
  isCartFull,
  markStale,
  newLineFromProduct,
  parseStoredCart,
  reconcileWithMenu,
  removeLine,
  serializeCart,
  setQuantity,
  updateForm,
  type NewCartLine,
} from '../../../app/utils/cart-storage'

const tea: PublicProduct = {
  id: 'p-tea',
  categoryId: null,
  name: 'Trà sữa',
  description: null,
  basePriceVnd: 35_000,
  isAvailable: true,
  imageUrl: null,
  optionGroups: [
    { id: 'g-size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }, { id: 'l', name: 'L', priceDeltaVnd: 7_000 }] },
    { id: 'g-top', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, values: [{ id: 'pearl', name: 'Trân châu', priceDeltaVnd: 5_000 }] },
  ],
}
const bread: PublicProduct = { ...tea, id: 'p-bread', name: 'Bánh mì', basePriceVnd: 20_000, optionGroups: [] }

const ids = () => {
  let n = 0
  return () => `line-${++n}`
}

const teaLine = (over: Partial<NewCartLine> = {}): NewCartLine => ({
  productId: 'p-tea',
  name: 'Trà sữa',
  optionValueIds: ['m'],
  optionLabels: ['M'],
  unitPriceVnd: 35_000,
  quantity: 1,
  note: '',
  ...over,
})

describe('addLine / setQuantity / removeLine', () => {
  it('merges identical lines (same product, options in any order, same note) and sums quantity', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ optionValueIds: ['m', 'pearl'], quantity: 2 }), newId)
    cart = addLine(cart, teaLine({ optionValueIds: ['pearl', 'm'], quantity: 3 }), newId)
    expect(cart.lines).toHaveLength(1)
    expect(cart.lines[0]!.quantity).toBe(5)
  })

  it('keeps different options or notes as separate lines', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine(), newId)
    cart = addLine(cart, teaLine({ optionValueIds: ['l'] }), newId)
    cart = addLine(cart, teaLine({ note: 'ít đá' }), newId)
    expect(cart.lines).toHaveLength(3)
  })

  it('caps a line at 50 and the cart at 30 lines', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ quantity: 40 }), newId)
    cart = addLine(cart, teaLine({ quantity: 40 }), newId)
    expect(cart.lines[0]!.quantity).toBe(50)

    let full = emptyCart()
    for (let i = 0; i < 35; i++) full = addLine(full, teaLine({ productId: `p${i}` }), newId)
    expect(full.lines).toHaveLength(30)
    expect(isCartFull(full)).toBe(true)
  })

  it('sets, clamps and removes by quantity', () => {
    const newId = ids()
    const cart = addLine(emptyCart(), teaLine({ quantity: 2 }), newId)
    expect(setQuantity(cart, 'line-1', 7).lines[0]!.quantity).toBe(7)
    expect(setQuantity(cart, 'line-1', 999).lines[0]!.quantity).toBe(50)
    expect(setQuantity(cart, 'line-1', 0).lines).toEqual([])
    expect(removeLine(cart, 'line-1').lines).toEqual([])
    expect(removeLine(cart, 'nope').lines).toHaveLength(1)
  })

  it('computes count and subtotal', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine({ quantity: 2 }), newId)
    cart = addLine(cart, teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [], quantity: 1 }), newId)
    expect(cartCount(cart)).toBe(3)
    expect(cartSubtotal(cart)).toBe(90_000)
  })
})

describe('newLineFromProduct', () => {
  it('prices the selection with the shared pricing rules and labels the options', () => {
    const line = newLineFromProduct(tea, { optionValueIds: ['l', 'pearl'], quantity: 2, note: '  ít ngọt ' })
    expect(line).toEqual({
      productId: 'p-tea',
      name: 'Trà sữa',
      optionValueIds: ['l', 'pearl'],
      optionLabels: ['L', 'Trân châu'],
      unitPriceVnd: 47_000,
      quantity: 2,
      note: 'ít ngọt',
    })
  })
})

describe('stale handling', () => {
  const twoLines = () => {
    const newId = ids()
    return addLine(addLine(emptyCart(), teaLine(), newId), teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [] }), newId)
  }

  it('markStale applies the server verdict by index and product id only', () => {
    const cart = markStale(twoLines(), [
      { index: 1, productId: 'p-bread', name: 'Bánh mì', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 },
      { index: 0, productId: 'someone-else', name: null, reason: 'PRODUCT_UNAVAILABLE', currentUnitPriceVnd: null },
    ])
    expect(cart.lines[0]!.stale).toBeNull()
    expect(cart.lines[1]).toMatchObject({ stale: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 })
    expect(hasStaleLines(cart)).toBe(true)
  })

  it('acceptCurrentPrice adopts the new price and clears the flag', () => {
    const marked = markStale(twoLines(), [{ index: 1, productId: 'p-bread', name: 'Bánh mì', reason: 'PRICE_CHANGED', currentUnitPriceVnd: 22_000 }])
    const accepted = acceptCurrentPrice(marked, marked.lines[1]!.lineId)
    expect(accepted.lines[1]).toMatchObject({ unitPriceVnd: 22_000, stale: null, currentUnitPriceVnd: null })
    expect(hasStaleLines(accepted)).toBe(false)
  })

  it('reconcileWithMenu flags unavailable, invalid-option and re-priced lines and clears healed ones', () => {
    const newId = ids()
    let cart = addLine(emptyCart(), teaLine(), newId)
    cart = addLine(cart, teaLine({ productId: 'p-bread', unitPriceVnd: 20_000, optionValueIds: [] }), newId)
    cart = addLine(cart, teaLine({ productId: 'p-gone', optionValueIds: [] }), newId)

    const soldOut = { ...bread, isAvailable: false }
    const flagged = reconcileWithMenu(cart, [tea, soldOut])
    expect(flagged.lines.map(line => line.stale)).toEqual([null, 'PRODUCT_UNAVAILABLE', 'PRODUCT_UNAVAILABLE'])

    const repriced = reconcileWithMenu(flagged, [{ ...tea, basePriceVnd: 38_000 }, bread])
    expect(repriced.lines[0]).toMatchObject({ stale: 'PRICE_CHANGED', currentUnitPriceVnd: 38_000 })
    expect(repriced.lines[1]!.stale).toBeNull()

    const optionGone = reconcileWithMenu(cart, [{ ...tea, optionGroups: [{ ...tea.optionGroups[0]!, values: [{ id: 'xl', name: 'XL', priceDeltaVnd: 9_000 }] }] }, bread])
    expect(optionGone.lines[0]!.stale).toBe('OPTION_INVALID')
  })
})

describe('idempotency key lifecycle', () => {
  it('reuses the key for an identical payload and issues a new one after any change', () => {
    let n = 0
    const newKey = () => `key-${++n}`
    const first = ensureIdempotency(emptyCart(), 'payload-A', newKey)
    const retry = ensureIdempotency(first.state, 'payload-A', newKey)
    const edited = ensureIdempotency(retry.state, 'payload-B', newKey)
    expect([first.key, retry.key, edited.key]).toEqual(['key-1', 'key-1', 'key-2'])
    expect(edited.state).toMatchObject({ pendingIdempotencyKey: 'key-2', pendingFingerprint: 'payload-B' })
  })

  it('clearAfterSuccess empties the cart and the pending key but remembers the customer and mode', () => {
    let cart = addLine(emptyCart(), teaLine(), ids())
    cart = updateForm(cart, { fulfillmentType: 'DELIVERY', customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' }, deliveryZoneId: 'z1', note: 'gọi trước' })
    cart = ensureIdempotency(cart, 'p', () => 'k').state
    expect(clearAfterSuccess(cart)).toEqual({
      ...emptyCart(),
      fulfillmentType: 'DELIVERY',
      customer: { name: 'Lan', phone: '0912345678', address: '12 Lê Lợi' },
      deliveryZoneId: 'z1',
    })
  })
})

describe('parseStoredCart / serializeCart (Review Focus #5)', () => {
  it('round-trips a cart', () => {
    const cart = updateForm(addLine(emptyCart(), teaLine({ quantity: 3 }), ids()), { fulfillmentType: 'PICKUP' })
    expect(parseStoredCart(serializeCart(cart))).toEqual(cart)
  })

  it.each([
    ['null', null],
    ['empty string', ''],
    ['not json', '{oops'],
    ['wrong version', JSON.stringify({ ...emptyCart(), version: 2 })],
    ['array instead of object', '[]'],
    ['quantity out of range', JSON.stringify({ ...emptyCart(), lines: [{ ...addLine(emptyCart(), teaLine(), ids()).lines[0], quantity: 999 }] })],
    ['negative price', JSON.stringify({ ...emptyCart(), lines: [{ ...addLine(emptyCart(), teaLine(), ids()).lines[0], unitPriceVnd: -1 }] })],
    ['more than 30 lines', JSON.stringify({ ...emptyCart(), lines: Array.from({ length: 31 }, (_, i) => ({ ...addLine(emptyCart(), teaLine(), () => `l${i}`).lines[0] })) })],
    ['hand-edited customer', JSON.stringify({ ...emptyCart(), customer: { name: 1 } })],
  ])('falls back to an empty cart for %s', (_label, raw) => {
    expect(parseStoredCart(raw)).toEqual(emptyCart())
  })
})


describe('cart numeric safety', () => {
  it.each([NaN, Infinity, -1, 0, 1.5])('rejects invalid new quantities %s', (quantity) => {
    expect(() => addLine(emptyCart(), teaLine({ quantity }), ids())).toThrow(RangeError)
  })

  it('rejects non-finite quantity edits and never creates zero from fractions', () => {
    const cart = addLine(emptyCart(), teaLine(), ids())
    for (const quantity of [NaN, Infinity, 0.5]) {
      expect(() => setQuantity(cart, cart.lines[0]!.lineId, quantity)).toThrow(RangeError)
    }
  })

  it('rejects unsafe line totals when loading stored carts', () => {
    const cart = addLine(emptyCart(), teaLine(), ids())
    cart.lines[0]!.unitPriceVnd = Number.MAX_SAFE_INTEGER
    cart.lines[0]!.quantity = 2
    expect(parseStoredCart(serializeCart(cart))).toEqual(emptyCart())
  })

  it('does not silently overflow the subtotal', () => {
    const cart = addLine(emptyCart(), teaLine(), ids())
    cart.lines[0]!.unitPriceVnd = Number.MAX_SAFE_INTEGER
    cart.lines[0]!.quantity = 2
    expect(() => cartSubtotal(cart)).toThrow(RangeError)
  })

  it('rejects an invalid selection rather than pricing an unknown option', () => {
    expect(() => newLineFromProduct(tea, { optionValueIds: ['missing'], quantity: 1 })).toThrow()
  })
})
