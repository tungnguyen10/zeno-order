import { describe, expect, it } from 'vitest'

import {
  calculateCartSubtotal,
  calculateLineTotal,
  calculateUnitPrice,
} from '../../app/domain/cart'

const item = {
  id: 'line-1',
  productId: 'product-1',
  productName: 'Cà phê sữa đá',
  basePrice: '9223372036854775807',
  options: [{
    optionGroupId: 'size',
    optionGroupName: 'Kích cỡ',
    optionValueId: 'large',
    optionValueName: 'Lớn',
    priceAdjustment: '12000',
  }],
  quantity: 2,
  note: '',
}

describe('cart money domain', () => {
  it('calculates unit and line totals losslessly', () => {
    expect(calculateUnitPrice(item)).toBe('9223372036854787807')
    expect(calculateLineTotal(item)).toBe('18446744073709575614')
  })

  it('sums cart lines with BigInt', () => {
    expect(calculateCartSubtotal([item, { ...item, id: 'line-2', quantity: 1 }])).toBe('27670116110564363421')
  })

  it('rejects malformed money and quantity', () => {
    expect(() => calculateLineTotal({ ...item, basePrice: '1.5' })).toThrow()
    expect(() => calculateLineTotal({ ...item, quantity: 0 })).toThrow()
  })
})
