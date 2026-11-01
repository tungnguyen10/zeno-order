import { describe, expect, it } from 'vitest'
import { generateToken, hashToken } from '../../../server/utils/tokens'

describe('generateToken', () => {
  it('returns 32 random bytes as 43 base64url characters', () => {
    const token = generateToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('honours the byte length and never repeats', () => {
    expect(generateToken(16)).toMatch(/^[A-Za-z0-9_-]{22}$/)
    const seen = new Set(Array.from({ length: 200 }, () => generateToken()))
    expect(seen.size).toBe(200)
  })
})

describe('hashToken', () => {
  it('is a deterministic sha256 hex digest', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(hashToken('abc')).toBe(hashToken('abc'))
    expect(hashToken('abc')).not.toBe(hashToken('abd'))
  })
})
