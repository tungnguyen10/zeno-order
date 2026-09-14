import { describe, expect, it } from 'vitest'

import {
  createPublicStoreService,
  mapPublicStore,
  publicSlugSchema,
  StoreNotFoundError,
} from '../../server/domain/store/public-store'

describe('publicSlugSchema', () => {
  it('accepts a lowercase kebab-case slug', () => {
    expect(publicSlugSchema.parse('mochi-cafe')).toBe('mochi-cafe')
  })

  it.each(['Mochi-Cafe', 'mochi_cafe', '-mochi', 'admin', 'api', 's'])('rejects invalid or reserved slug %s', (slug) => {
    expect(() => publicSlugSchema.parse(slug)).toThrow()
  })
})

describe('mapPublicStore', () => {
  it('maps the safe database row to the public API shape', () => {
    expect(mapPublicStore({
      public_slug: 'mochi-cafe',
      name: 'Mochi Cafe',
      description: null,
      logo_path: null,
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
    })).toEqual({
      publicSlug: 'mochi-cafe',
      name: 'Mochi Cafe',
      description: null,
      logoPath: null,
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
    })
  })
})

describe('createPublicStoreService', () => {
  const row = {
    public_slug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: null,
    logo_path: null,
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  }

  it('returns a mapped public store without internal identifiers', async () => {
    const service = createPublicStoreService({
      findPublicBySlug: async () => row,
    })

    await expect(service.resolve('mochi-cafe')).resolves.toEqual({
      publicSlug: 'mochi-cafe',
      name: 'Mochi Cafe',
      description: null,
      logoPath: null,
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
    })
  })

  it('maps an invalid slug to the same not-found error as a missing store', async () => {
    const service = createPublicStoreService({
      findPublicBySlug: async () => null,
    })

    await expect(service.resolve('INVALID')).rejects.toBeInstanceOf(StoreNotFoundError)
    await expect(service.resolve('missing-store')).rejects.toBeInstanceOf(StoreNotFoundError)
  })
})
