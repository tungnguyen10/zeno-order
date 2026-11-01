import { describe, expect, it } from 'vitest'
import { createTableInputSchema, updateTableInputSchema } from '#shared/schemas/tables'
import { buildTableQrUrl, nextTableCode } from '../../../server/services/catalog/tables'

describe('nextTableCode', () => {
  it.each([
    [[], '01'],
    [['01', '02'], '03'],
    [['A1', '07'], '08'],
    [['99'], '100'],
    [['abc', 'T-1'], '01'],
  ])('%j → %s', (existing, expected) => {
    expect(nextTableCode(existing)).toBe(expected)
  })
})

describe('buildTableQrUrl', () => {
  it('joins base, slug and token without double slashes', () => {
    expect(buildTableQrUrl('https://zeno.vn/', 'tra-sua-may', 'abc_DEF-123')).toBe('https://zeno.vn/s/tra-sua-may?t=abc_DEF-123')
    expect(buildTableQrUrl('http://localhost:3000', 'a', 't')).toBe('http://localhost:3000/s/a?t=t')
  })
})

describe('table schemas', () => {
  it('accepts an empty create body (auto code) and restricts manual codes', () => {
    expect(createTableInputSchema.parse({})).toEqual({})
    expect(createTableInputSchema.parse({ code: ' A1 ', displayName: 'Bàn cửa sổ' })).toEqual({ code: 'A1', displayName: 'Bàn cửa sổ' })
    for (const code of ['', 'a b', 'bàn', 'x'.repeat(21), '../1']) {
      expect(createTableInputSchema.safeParse({ code }).success).toBe(false)
    }
  })

  it('update needs a change', () => {
    expect(updateTableInputSchema.safeParse({}).success).toBe(false)
    expect(updateTableInputSchema.safeParse({ active: false }).success).toBe(true)
  })
})
