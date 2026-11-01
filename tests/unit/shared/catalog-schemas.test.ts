import { describe, expect, it } from 'vitest'
import { MAX_PRICE_VND, vndSchema } from '#shared/schemas/common'
import {
  createCategoryInputSchema,
  createProductInputSchema,
  replaceOptionsInputSchema,
  updateCategoryInputSchema,
  updateProductInputSchema,
} from '#shared/schemas/catalog'

describe('vndSchema', () => {
  it.each([0, 35000, MAX_PRICE_VND])('accepts %s', (value) => {
    expect(vndSchema.safeParse(value).success).toBe(true)
  })

  it.each([-1, 1.5, MAX_PRICE_VND + 1, Number.NaN, Number.POSITIVE_INFINITY, '35000', null])('rejects %s', (value) => {
    expect(vndSchema.safeParse(value).success).toBe(false)
  })
})

describe('category schemas', () => {
  it('trims names and rejects blank or over-long ones', () => {
    expect(createCategoryInputSchema.parse({ name: '  Trà sữa  ' })).toEqual({ name: 'Trà sữa' })
    expect(createCategoryInputSchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createCategoryInputSchema.safeParse({ name: 'a'.repeat(61) }).success).toBe(false)
  })

  it('requires at least one change on update', () => {
    expect(updateCategoryInputSchema.safeParse({}).success).toBe(false)
    expect(updateCategoryInputSchema.safeParse({ active: false }).success).toBe(true)
    expect(updateCategoryInputSchema.safeParse({ position: -1 }).success).toBe(false)
  })
})

describe('product schemas', () => {
  it('quick add needs only a name and a price', () => {
    expect(createProductInputSchema.parse({ name: ' Trà đào ', basePriceVnd: 30000 })).toEqual({ name: 'Trà đào', basePriceVnd: 30000 })
  })

  it('accepts a null or uuid category and rejects garbage', () => {
    const id = '5f0c1a52-6a6a-4f0e-9d2e-0d1f6f0f6f0f'
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: null }).success).toBe(true)
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: id }).success).toBe(true)
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 1, categoryId: 'abc' }).success).toBe(false)
  })

  it('rejects a negative, fractional or oversized price', () => {
    for (const basePriceVnd of [-1, 10.5, MAX_PRICE_VND + 1]) {
      expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd }).success).toBe(false)
    }
  })

  it('update treats categoryId null as a change and an empty patch as an error', () => {
    expect(updateProductInputSchema.safeParse({ categoryId: null }).success).toBe(true)
    expect(updateProductInputSchema.safeParse({ isAvailable: false }).success).toBe(true)
    expect(updateProductInputSchema.safeParse({}).success).toBe(false)
  })
})

describe('replaceOptionsInputSchema', () => {
  const value = (name: string, extra: Record<string, unknown> = {}) => ({ name, ...extra })

  it('applies value defaults and normalises a required group to minSelect ≥ 1', () => {
    const parsed = replaceOptionsInputSchema.parse({
      groups: [{ name: 'Size', required: true, minSelect: 0, maxSelect: 1, values: [value('M'), value('L', { priceDeltaVnd: 5000 })] }],
    })
    expect(parsed.groups[0]).toMatchObject({ minSelect: 1, maxSelect: 1 })
    expect(parsed.groups[0]!.values).toEqual([
      { name: 'M', priceDeltaVnd: 0, active: true },
      { name: 'L', priceDeltaVnd: 5000, active: true },
    ])
  })

  it('accepts an empty list (removes every option)', () => {
    expect(replaceOptionsInputSchema.parse({ groups: [] })).toEqual({ groups: [] })
  })

  it('rejects maxSelect < minSelect', () => {
    const result = replaceOptionsInputSchema.safeParse({
      groups: [{ name: 'Topping', required: false, minSelect: 3, maxSelect: 2, values: [value('a'), value('b'), value('c')] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a minimum that exceeds the number of active values', () => {
    const result = replaceOptionsInputSchema.safeParse({
      groups: [{ name: 'Size', required: true, minSelect: 2, maxSelect: 2, values: [value('M'), value('L', { active: false })] }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects a group without values, a negative delta and too many groups', () => {
    const group = (values: unknown[]) => ({ name: 'G', required: false, minSelect: 0, maxSelect: 1, values })
    expect(replaceOptionsInputSchema.safeParse({ groups: [group([])] }).success).toBe(false)
    expect(replaceOptionsInputSchema.safeParse({ groups: [group([value('a', { priceDeltaVnd: -1 })])] }).success).toBe(false)
    expect(replaceOptionsInputSchema.safeParse({ groups: Array.from({ length: 11 }, () => group([value('a')])) }).success).toBe(false)
  })
})


describe('catalog schema boundaries', () => {
  it('ignores unknown properties without accepting an empty effective patch', () => {
    expect(updateCategoryInputSchema.safeParse({ orgId: 'foreign' }).success).toBe(false)
    expect(updateProductInputSchema.safeParse({ name: undefined }).success).toBe(false)
    expect(createCategoryInputSchema.parse({ name: ' A ', active: false })).toEqual({ name: 'A' })
  })

  it('enforces product name, description and position limits', () => {
    expect(createProductInputSchema.safeParse({ name: 'a'.repeat(81), basePriceVnd: 0 }).success).toBe(false)
    expect(createProductInputSchema.safeParse({ name: 'A', basePriceVnd: 0, description: 'a'.repeat(301) }).success).toBe(false)
    expect(updateProductInputSchema.safeParse({ description: null, position: 100000 }).success).toBe(true)
    expect(updateCategoryInputSchema.safeParse({ position: 100001 }).success).toBe(false)
    expect(updateCategoryInputSchema.safeParse({ position: 0.5 }).success).toBe(false)
  })

  it('checks capacity after required-group normalisation', () => {
    const group = { name: 'Size', required: true, minSelect: 0, maxSelect: 1, values: [{ name: 'M', active: false }] }
    expect(replaceOptionsInputSchema.safeParse({ groups: [group] }).success).toBe(false)
  })
})
