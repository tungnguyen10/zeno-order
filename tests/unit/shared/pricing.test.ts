import { describe, expect, it } from 'vitest'
import {
  defaultSelection,
  MAX_LINE_QUANTITY,
  orderTotals,
  priceLine,
  selectionDeltas,
  toggleSelection,
  toOptionRules,
  validateSelection,
  type OptionGroupRule,
} from '#shared/pricing'

const size: OptionGroupRule = {
  id: 'g-size',
  minSelect: 1,
  maxSelect: 1,
  required: true,
  values: [
    { id: 'm', priceDeltaVnd: 0, active: true },
    { id: 'l', priceDeltaVnd: 5000, active: true },
    { id: 'xl', priceDeltaVnd: 9000, active: false },
  ],
}
const topping: OptionGroupRule = {
  id: 'g-top',
  minSelect: 0,
  maxSelect: 2,
  required: false,
  values: [
    { id: 'tran-chau', priceDeltaVnd: 5000, active: true },
    { id: 'thach', priceDeltaVnd: 3000, active: true },
    { id: 'pudding', priceDeltaVnd: 7000, active: true },
  ],
}
const groups = [size, topping]

describe('validateSelection', () => {
  it('accepts a valid selection and returns ids in group order', () => {
    expect(validateSelection(groups, ['thach', 'l'])).toEqual({ ok: true, valueIds: ['l', 'thach'] })
  })

  it('accepts an empty selection when no group is required (min 0)', () => {
    expect(validateSelection([topping], [])).toEqual({ ok: true, valueIds: [] })
  })

  it('REQUIRED_MISSING when a required group has no pick', () => {
    expect(validateSelection(groups, ['thach'])).toEqual({ ok: false, reason: 'REQUIRED_MISSING', groupId: 'g-size' })
  })

  it('TOO_FEW when picks are below minSelect of an optional group', () => {
    const optionalMin2: OptionGroupRule = { ...topping, minSelect: 2 }
    expect(validateSelection([optionalMin2], ['thach'])).toEqual({ ok: false, reason: 'TOO_FEW', groupId: 'g-top' })
  })

  it('TOO_MANY when picks exceed maxSelect', () => {
    expect(validateSelection(groups, ['m', 'l'])).toEqual({ ok: false, reason: 'TOO_MANY', groupId: 'g-size' })
    expect(validateSelection(groups, ['m', 'tran-chau', 'thach', 'pudding'])).toEqual({ ok: false, reason: 'TOO_MANY', groupId: 'g-top' })
  })

  it('UNKNOWN_VALUE for an id that belongs to no group', () => {
    expect(validateSelection(groups, ['m', 'khong-co'])).toEqual({ ok: false, reason: 'UNKNOWN_VALUE' })
  })

  it('INACTIVE_VALUE for a disabled value, with its group', () => {
    expect(validateSelection(groups, ['xl'])).toEqual({ ok: false, reason: 'INACTIVE_VALUE', groupId: 'g-size' })
  })

  it('DUPLICATE_VALUE when the same id is sent twice', () => {
    expect(validateSelection(groups, ['m', 'm'])).toEqual({ ok: false, reason: 'DUPLICATE_VALUE', groupId: 'g-size' })
  })
})

describe('defaultSelection', () => {
  it('picks the first active value of every required group', () => {
    expect(defaultSelection(groups)).toEqual(['m'])
  })

  it('skips inactive values and optional groups', () => {
    const allButLast: OptionGroupRule = { ...size, values: [{ id: 'a', priceDeltaVnd: 0, active: false }, { id: 'b', priceDeltaVnd: 0, active: true }] }
    expect(defaultSelection([allButLast, topping])).toEqual(['b'])
  })

  it('returns enough values to satisfy a required group with minSelect > 1', () => {
    const two: OptionGroupRule = { ...topping, required: true, minSelect: 2 }
    expect(defaultSelection([two])).toEqual(['tran-chau', 'thach'])
  })

  it('always produces a selection that validates', () => {
    expect(validateSelection(groups, defaultSelection(groups)).ok).toBe(true)
  })
})

describe('toggleSelection', () => {
  it('replaces the pick of a single-choice group', () => {
    expect(toggleSelection(size, ['m', 'thach'], 'l')).toEqual(['thach', 'l'])
  })

  it('does not clear a required single-choice group by tapping the selected value', () => {
    expect(toggleSelection(size, ['m'], 'm')).toEqual(['m'])
  })

  it('clears an optional single-choice group when tapping the selected value', () => {
    const optional: OptionGroupRule = { ...size, required: false, minSelect: 0 }
    expect(toggleSelection(optional, ['m'], 'm')).toEqual([])
  })

  it('adds up to maxSelect in a multi group and ignores extra taps', () => {
    let selected = toggleSelection(topping, [], 'thach')
    selected = toggleSelection(topping, selected, 'pudding')
    expect(selected).toEqual(['thach', 'pudding'])
    expect(toggleSelection(topping, selected, 'tran-chau')).toEqual(['thach', 'pudding'])
    expect(toggleSelection(topping, selected, 'thach')).toEqual(['pudding'])
  })

  it('ignores inactive and unknown values', () => {
    expect(toggleSelection(size, ['m'], 'xl')).toEqual(['m'])
    expect(toggleSelection(size, ['m'], 'nope')).toEqual(['m'])
  })
})

describe('selectionDeltas', () => {
  it('returns the price delta of each selected value', () => {
    // Group order first (size), then value order inside the group (tran-chau 5000 before thach 3000).
    expect(selectionDeltas(groups, ['l', 'thach', 'tran-chau'])).toEqual([5000, 5000, 3000])
  })
})

describe('priceLine', () => {
  it('adds topping deltas to the base price and multiplies by quantity', () => {
    expect(priceLine({ basePriceVnd: 30000, deltasVnd: [5000, 3000], quantity: 2 })).toEqual({ unitPriceVnd: 38000, lineTotalVnd: 76000 })
  })

  it('works without options', () => {
    expect(priceLine({ basePriceVnd: 25000, deltasVnd: [], quantity: 1 })).toEqual({ unitPriceVnd: 25000, lineTotalVnd: 25000 })
  })

  it.each([0, 51, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('rejects quantity %s', (quantity) => {
    expect(() => priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity })).toThrow(RangeError)
  })

  it('accepts the boundaries 1 and MAX_LINE_QUANTITY', () => {
    expect(priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity: 1 }).lineTotalVnd).toBe(1000)
    expect(priceLine({ basePriceVnd: 1000, deltasVnd: [], quantity: MAX_LINE_QUANTITY }).lineTotalVnd).toBe(50000)
  })

  it('throws instead of overflowing past the safe integer range', () => {
    expect(() => priceLine({ basePriceVnd: Number.MAX_SAFE_INTEGER, deltasVnd: [1], quantity: 1 })).toThrow(RangeError)
    expect(() => priceLine({ basePriceVnd: Math.floor(Number.MAX_SAFE_INTEGER / 2), deltasVnd: [], quantity: 3 })).toThrow(RangeError)
  })

  it('rejects negative or fractional amounts', () => {
    expect(() => priceLine({ basePriceVnd: -1, deltasVnd: [], quantity: 1 })).toThrow(RangeError)
    expect(() => priceLine({ basePriceVnd: 1000, deltasVnd: [0.5], quantity: 1 })).toThrow(RangeError)
  })
})

describe('orderTotals', () => {
  it('sums lines and adds the delivery fee', () => {
    expect(orderTotals({ lineTotalsVnd: [76000, 25000], deliveryFeeVnd: 15000 })).toEqual({ subtotalVnd: 101000, deliveryFeeVnd: 15000, totalVnd: 116000 })
  })

  it('handles an empty order', () => {
    expect(orderTotals({ lineTotalsVnd: [], deliveryFeeVnd: 0 })).toEqual({ subtotalVnd: 0, deliveryFeeVnd: 0, totalVnd: 0 })
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid line total %s', (lineTotalVnd) => {
    expect(() => orderTotals({ lineTotalsVnd: [lineTotalVnd], deliveryFeeVnd: 0 })).toThrow(RangeError)
  })

  it('throws on overflow or invalid fee', () => {
    expect(() => orderTotals({ lineTotalsVnd: [Number.MAX_SAFE_INTEGER, 1], deliveryFeeVnd: 0 })).toThrow(RangeError)
    expect(() => orderTotals({ lineTotalsVnd: [1000], deliveryFeeVnd: -5 })).toThrow(RangeError)
    expect(() => orderTotals({ lineTotalsVnd: [Number.MAX_SAFE_INTEGER], deliveryFeeVnd: 1 })).toThrow(RangeError)
  })
})

describe('toOptionRules', () => {
  it('preserves explicitly inactive values', () => {
    expect(toOptionRules([size])).toEqual([size])
  })

  it('defaults active to true and strips extra fields', () => {
    const dto = [{ id: 'g', name: 'Size', minSelect: 1, maxSelect: 1, required: true, values: [{ id: 'm', name: 'M', priceDeltaVnd: 0 }] }]
    const rules = toOptionRules(dto)
    expect(rules).toEqual([{ id: 'g', minSelect: 1, maxSelect: 1, required: true, values: [{ id: 'm', priceDeltaVnd: 0, active: true }] }])
  })
})
