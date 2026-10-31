import { describe, expect, it, vi } from 'vitest'
import { createTokenCache, decodeJwtExp, isTokenFresh } from '../../../app/utils/auth-token'

function fakeJwt(exp: number): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'EdDSA' })}.${encode({ sub: 'u', exp })}.sig`
}

describe('decodeJwtExp / isTokenFresh', () => {
  it('reads exp from a base64url payload', () => {
    expect(decodeJwtExp(fakeJwt(1_900_000_000))).toBe(1_900_000_000)
  })

  it('returns null for malformed tokens', () => {
    expect(decodeJwtExp('abc')).toBeNull()
    expect(decodeJwtExp('a.!!!.c')).toBeNull()
  })

  it('treats tokens expiring within the skew as stale', () => {
    expect(isTokenFresh(fakeJwt(1000), 900)).toBe(true)
    expect(isTokenFresh(fakeJwt(1000), 950)).toBe(false)
    expect(isTokenFresh('abc', 0)).toBe(false)
  })
})

describe('createTokenCache', () => {
  it('reuses a fresh token and refetches when stale', async () => {
    let now = 1000
    const token = vi.fn()
      .mockResolvedValueOnce({ data: { token: fakeJwt(2000) } })
      .mockResolvedValueOnce({ data: { token: fakeJwt(3000) } })
    const cache = createTokenCache({ token }, () => now)
    const first = await cache.get()
    expect(await cache.get()).toBe(first)
    expect(token).toHaveBeenCalledTimes(1)
    now = 1990
    expect(await cache.get()).not.toBe(first)
    expect(token).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight request between concurrent callers', async () => {
    const token = vi.fn().mockResolvedValue({ data: { token: fakeJwt(5000) } })
    const cache = createTokenCache({ token }, () => 1000)
    const [a, b] = await Promise.all([cache.get(), cache.get()])
    expect(a).toBe(b)
    expect(token).toHaveBeenCalledTimes(1)
  })

  it('returns null when signed out and refetches after clear()', async () => {
    const token = vi.fn()
      .mockResolvedValueOnce({ data: null })
      .mockResolvedValueOnce({ data: { token: fakeJwt(5000) } })
    const cache = createTokenCache({ token }, () => 1000)
    expect(await cache.get()).toBeNull()
    cache.clear()
    expect(await cache.get()).not.toBeNull()
  })

  it('drops an in-flight token when clear() is called before it resolves', async () => {
    let resolveFirst!: (value: { data: { token: string } }) => void
    const token = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ data: null })
    const cache = createTokenCache({ token }, () => 1000)
    const pending = cache.get()
    cache.clear()
    resolveFirst({ data: { token: fakeJwt(5000) } })
    expect(await pending).toBeNull()
    expect(await cache.get()).toBeNull()
    expect(token).toHaveBeenCalledTimes(2)
  })
})
