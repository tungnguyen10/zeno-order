import { describe, expect, it } from 'vitest'
import { assertVnd, formatVnd } from '#shared/money'

describe('formatVnd', () => {
  it('formats with dot thousands separator and đ suffix', () => {
    expect(formatVnd(25000)).toBe('25.000đ')
    expect(formatVnd(1250000)).toBe('1.250.000đ')
    expect(formatVnd(0)).toBe('0đ')
  })
})

describe('assertVnd', () => {
  it('accepts non-negative safe integers', () => {
    expect(assertVnd(35000)).toBe(35000)
  })
  it.each([-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    expect(() => assertVnd(value)).toThrow(RangeError)
  })
})
