import { describe, expect, it } from 'vitest'

import {
  createDefaultSelections,
  validateProductConfiguration,
} from '../../app/domain/product-configuration'

const groups = [
  {
    id: 'size',
    name: 'Kích cỡ',
    selectionType: 'single' as const,
    required: true,
    minSelect: 1,
    maxSelect: 1,
    values: [
      { id: 'small', name: 'Nhỏ', priceAdjustment: '0', isDefault: true },
      { id: 'large', name: 'Lớn', priceAdjustment: '12000', isDefault: false },
    ],
  },
  {
    id: 'topping',
    name: 'Topping',
    selectionType: 'multiple' as const,
    required: false,
    minSelect: 0,
    maxSelect: 2,
    values: [
      { id: 'pearl', name: 'Trân châu', priceAdjustment: '8000', isDefault: false },
      { id: 'jelly', name: 'Thạch', priceAdjustment: '9000', isDefault: false },
    ],
  },
]

describe('product configuration', () => {
  it('selects active catalog defaults when opening the sheet', () => {
    expect(createDefaultSelections(groups)).toEqual({ size: ['small'], topping: [] })
  })

  it('accepts a valid generic selection', () => {
    expect(validateProductConfiguration(groups, {
      size: ['large'],
      topping: ['pearl', 'jelly'],
    }, 2, 'Ít đá').valid).toBe(true)
  })

  it.each([
    [{ size: [], topping: [] }, 'size'],
    [{ size: ['small', 'large'], topping: [] }, 'size'],
    [{ size: ['small'], topping: ['pearl', 'jelly', 'other'] }, 'topping'],
    [{ size: ['unknown'], topping: [] }, 'size'],
    [{ size: ['small'], topping: ['pearl', 'pearl'] }, 'topping'],
  ])('rejects invalid option combinations', (selections, groupId) => {
    const result = validateProductConfiguration(groups, selections, 1, '')

    expect(result.valid).toBe(false)
    expect(result.errors[groupId]).toBeTruthy()
  })

  it('rejects quantity and note outside client limits', () => {
    expect(validateProductConfiguration(groups, { size: ['small'] }, 0, '').errors.quantity).toBeTruthy()
    expect(validateProductConfiguration(groups, { size: ['small'] }, 100, '').errors.quantity).toBeTruthy()
    expect(validateProductConfiguration(groups, { size: ['small'] }, 1, 'x'.repeat(501)).errors.note).toBeTruthy()
  })
})
