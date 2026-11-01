import { describe, expect, it } from 'vitest'
import { assertVnd, formatVnd, parseVndInput } from '#shared/money'

describe('formatVnd', () => {
  it('formats with dot thousands separator and đ suffix', () => {
    expect(formatVnd(25000)).toBe('25.000đ')
    expect(formatVnd(1250000)).toBe('1.250.000đ')
    expect(formatVnd(0)).toBe('0đ')
  })
})

describe('parseVndInput', () => {
  it.each([
    ['35000', 35000], ['35.000', 35000], ['35,000', 35000], ['1.250.000', 1250000],
    [' 35 000 ', 35000], ['35k', 35000], ['35K', 35000], ['2.5k', 2500],
    ['2,5k', 2500], ['35000đ', 35000], ['35.000 đ', 35000], ['35000 VND', 35000],
    ['35000vnđ', 35000], ['0', 0], ['035000', 35000],
  ] as const)('%s → %i', (input, expected) => {
    expect(parseVndInput(input)).toBe(expected)
  })

  it.each(['', '   ', 'abc', '-5', '35.5', '35.50', '3.5', '1,2', '35k5', '2.50k', 'k', '1.2.3', '35.0000', '99999999999999999999'])('%j → null', (input) => {
    expect(parseVndInput(input)).toBeNull()
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
