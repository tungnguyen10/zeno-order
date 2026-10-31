import { describe, expect, it } from 'vitest'
import { onboardingInputSchema, slugify, slugSchema, updateStoreInputSchema } from '#shared/schemas/identity'

describe('slugify', () => {
  it.each([
    ['Trà Sữa Đậu Đỏ', 'tra-sua-dau-do'],
    ['  Hello   World!! ', 'hello-world'],
    ['Cà phê Muối 24/7', 'ca-phe-muoi-24-7'],
    ['---', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugify(input)).toBe(expected)
  })

  it('caps length at 40 without a trailing dash', () => {
    const slug = slugify('a'.repeat(39) + ' bcd')
    expect(slug.length).toBeLessThanOrEqual(40)
    expect(slug.endsWith('-')).toBe(false)
  })
})

describe('slugSchema', () => {
  it('normalizes case and whitespace', () => {
    expect(slugSchema.parse('  Tra-Sua-A1 ')).toBe('tra-sua-a1')
  })

  it.each(['ab', 'app', 'api', 's', 'o', 'login', 'bad slug', 'a--b', '-ab', 'ab-', 'trà-sữa', 'x'.repeat(41)])(
    'rejects %s',
    (value) => {
      expect(slugSchema.safeParse(value).success).toBe(false)
    },
  )
})

describe('onboardingInputSchema', () => {
  it('trims names and validates slug', () => {
    expect(onboardingInputSchema.parse({ orgName: '  Zeno  ', storeName: ' Quán A ', storeSlug: 'quan-a' }))
      .toEqual({ orgName: 'Zeno', storeName: 'Quán A', storeSlug: 'quan-a' })
  })

  it('rejects too-short names', () => {
    expect(onboardingInputSchema.safeParse({ orgName: 'Z', storeName: 'Quán A', storeSlug: 'quan-a' }).success).toBe(false)
  })
})

describe('updateStoreInputSchema', () => {
  it('requires at least one field', () => {
    expect(updateStoreInputSchema.safeParse({}).success).toBe(false)
    expect(updateStoreInputSchema.parse({ isAcceptingOrders: true })).toEqual({ isAcceptingOrders: true })
  })

  it('strips unknown fields such as slug or orgId', () => {
    expect(updateStoreInputSchema.parse({ name: 'Quán B', orgId: 'x', slug: 'y' })).toEqual({ name: 'Quán B' })
  })
})
