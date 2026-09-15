import { describe, expect, it } from 'vitest'

import { formatMoney } from '../../app/utils/format-money'

describe('formatMoney', () => {
  it('formats a decimal integer string without a floating-point conversion', () => {
    expect(formatMoney('35000', 'VND')).toBe('35.000 ₫')
  })

  it('supports values beyond JavaScript safe integer range', () => {
    expect(formatMoney('9223372036854775807', 'VND')).toContain('9.223.372.036.854.775.807')
  })

  it('rejects malformed monetary values', () => {
    expect(() => formatMoney('35.5', 'VND')).toThrow('Invalid monetary value')
  })
})
