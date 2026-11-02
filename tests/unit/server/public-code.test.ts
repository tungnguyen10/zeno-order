import { describe, expect, it } from 'vitest'
import { generatePublicCode, PUBLIC_CODE_ALPHABET, PUBLIC_CODE_LENGTH } from '../../../server/services/ordering/public-code'

describe('generatePublicCode', () => {
  it('uses the spec alphabet: 32 characters without 0, O, 1, I', () => {
    expect(PUBLIC_CODE_ALPHABET).toBe('23456789ABCDEFGHJKLMNPQRSTUVWXYZ')
    expect(PUBLIC_CODE_ALPHABET).toHaveLength(32)
    expect(PUBLIC_CODE_ALPHABET).not.toMatch(/[01OI]/)
  })

  it('returns 6 characters from the alphabet', () => {
    expect(PUBLIC_CODE_LENGTH).toBe(6)
    for (let i = 0; i < 2000; i++) expect(generatePublicCode()).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
  })

  it('is not constant and eventually uses every alphabet character', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) for (const char of generatePublicCode()) seen.add(char)
    expect(seen.size).toBe(32)
  })
})
