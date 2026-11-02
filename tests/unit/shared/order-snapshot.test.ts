import { describe, expect, it } from 'vitest'
import { optionLabels } from '../../../shared/order-snapshot'

describe('optionLabels', () => {
  it('reads valueName, name or label from objects', () => {
    expect(optionLabels([{ groupName: 'Đường', valueName: '50%' }, { name: 'Trân châu' }, { label: 'Đá riêng' }]))
      .toEqual(['50%', 'Trân châu', 'Đá riêng'])
  })

  it('accepts plain strings and nested value lists', () => {
    expect(optionLabels(['Ít đá', { groupName: 'Topping', values: [{ valueName: 'Pudding' }, { valueName: 'Thạch' }] }]))
      .toEqual(['Ít đá', 'Pudding', 'Thạch'])
  })

  it.each([null, undefined, 'x', 5, {}, [null, 1, {}, { valueName: '' }]])('ignores %j', (value) => {
    expect(optionLabels(value)).toEqual([])
  })
})
