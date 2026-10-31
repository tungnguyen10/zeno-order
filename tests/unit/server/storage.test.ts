import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicObjectUrl } from '../../../server/services/storage'

afterEach(() => vi.unstubAllEnvs())

describe('publicObjectUrl', () => {
  it('builds a path-style URL and encodes each key segment', () => {
    vi.stubEnv('AWS_ENDPOINT_URL_S3', 'https://br-x.storage.example.neon.tech/')
    expect(publicObjectUrl('product-images', 'stores/s1/trà sữa.webp'))
      .toBe('https://br-x.storage.example.neon.tech/product-images/stores/s1/tr%C3%A0%20s%E1%BB%AFa.webp')
  })

  it('throws when the endpoint env is missing', () => {
    vi.stubEnv('AWS_ENDPOINT_URL_S3', '')
    expect(() => publicObjectUrl('product-images', 'a.webp')).toThrow('Missing env AWS_ENDPOINT_URL_S3')
  })
})
