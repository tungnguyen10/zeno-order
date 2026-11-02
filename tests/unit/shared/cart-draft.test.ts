import { describe, expect, it } from 'vitest'
import { addToDraft, draftTotals, lineKey, type DraftLine } from '#shared/cart-draft'
import type { PublicProduct } from '#shared/types/catalog'

const tea: PublicProduct = {
  id: 'p1', categoryId: null, name: 'Trà sữa', description: null, basePriceVnd: 30000, isAvailable: true, imageUrl: null,
  optionGroups: [
    { id: 'g-size', name: 'Size', required: true, minSelect: 1, maxSelect: 1, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }, { id: 'l', name: 'L', priceDeltaVnd: 5000 }] },
    { id: 'g-top', name: 'Topping', required: false, minSelect: 0, maxSelect: 2, values: [{ id: 'tc', name: 'Trân châu', priceDeltaVnd: 5000 }, { id: 'th', name: 'Thạch', priceDeltaVnd: 3000 }] },
  ],
}
const flan: PublicProduct = { ...tea, id: 'p2', name: 'Bánh flan', basePriceVnd: 20000, optionGroups: [] }

describe('addToDraft', () => {
  it('prices the line from the base price and the selected deltas', () => {
    expect(addToDraft([], tea, ['th', 'l'], 2)).toEqual<DraftLine[]>([{ key: 'p1:l,th', productId: 'p1', name: 'Trà sữa', optionLabels: ['L', 'Thạch'], valueIds: ['l', 'th'], quantity: 2, unitPriceVnd: 38000 }])
  })

  it('merges identical selections regardless of click order and keeps different ones apart', () => {
    let lines = addToDraft([], tea, ['th', 'l'], 1)
    lines = addToDraft(lines, tea, ['l', 'th'], 2)
    lines = addToDraft(lines, tea, ['m'], 1)
    expect(lines.map(l => [l.key, l.quantity])).toEqual([['p1:l,th', 3], ['p1:m', 1]])
  })

  it('caps a merged line at 50', () => {
    const lines = addToDraft(addToDraft([], flan, [], 40), flan, [], 40)
    expect(lines[0]!.quantity).toBe(50)
  })

  it('rejects unavailable products, bad selections and bad quantities', () => {
    expect(() => addToDraft([], { ...tea, isAvailable: false }, ['m'], 1)).toThrow(RangeError)
    expect(() => addToDraft([], tea, [], 1)).toThrow(RangeError)
    expect(() => addToDraft([], tea, ['m', 'l'], 1)).toThrow(RangeError)
    expect(() => addToDraft([], flan, [], 0)).toThrow(RangeError)
    expect(() => addToDraft([], flan, [], 51)).toThrow(RangeError)
  })
})

describe('draftTotals', () => {
  it('counts items and sums line totals', () => {
    const lines = addToDraft(addToDraft([], tea, ['l'], 2), flan, [], 1)
    expect(draftTotals(lines)).toEqual({ count: 3, totalVnd: 2 * 35000 + 20000 })
    expect(draftTotals([])).toEqual({ count: 0, totalVnd: 0 })
  })
})

describe('lineKey', () => {
  it('is order independent', () => {
    expect(lineKey('p', ['b', 'a'])).toBe(lineKey('p', ['a', 'b']))
  })
})
