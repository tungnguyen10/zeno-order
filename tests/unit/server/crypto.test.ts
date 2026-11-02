import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertEncryptionKey, decryptSecret, encryptSecret } from '../../../server/utils/crypto'

const KEY = randomBytes(32).toString('base64')

beforeEach(() => {
  vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function tamper(blob: string, partIndex: number): string {
  const parts = blob.split('.')
  const bytes = Buffer.from(parts[partIndex]!, 'base64url')
  bytes[0] = bytes[0]! ^ 0x01
  parts[partIndex] = bytes.toString('base64url')
  return parts.join('.')
}

describe('encryptSecret / decryptSecret', () => {
  it.each(['', 'hmac-secret', 'Trà sữa 🧋 — bí mật', 'x'.repeat(5000)])('round-trips %j', (plain) => {
    expect(decryptSecret(encryptSecret(plain))).toBe(plain)
  })

  it('uses the v1.<iv>.<tag>.<ct> format with base64url parts', () => {
    const parts = encryptSecret('abc').split('.')
    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('v1')
    for (const part of parts.slice(1)) expect(part).toMatch(/^[A-Za-z0-9_-]*$/)
    expect(Buffer.from(parts[1]!, 'base64url')).toHaveLength(12)
    expect(Buffer.from(parts[2]!, 'base64url')).toHaveLength(16)
  })

  it('never reuses an IV, so equal plaintexts give different blobs', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it.each([['iv', 1], ['tag', 2], ['ciphertext', 3]] as const)('rejects a tampered %s', (_label, index) => {
    const blob = encryptSecret('top-secret')
    expect(() => decryptSecret(tamper(blob, index))).toThrow('Invalid encrypted secret')
  })

  it('rejects a blob encrypted under another key', () => {
    const blob = encryptSecret('top-secret')
    vi.stubEnv('APP_ENCRYPTION_KEY', randomBytes(32).toString('base64'))
    expect(() => decryptSecret(blob)).toThrow('Invalid encrypted secret')
  })

  it.each(['', 'garbage', 'v2.a.b.c', 'v1.a.b', 'v1.a.b.c.d', 'v1...'])('rejects malformed blob %j', (blob) => {
    expect(() => decryptSecret(blob)).toThrow('Invalid encrypted secret')
  })

  it('rejects noncanonical base64url parts rather than silently ignoring characters', () => {
    const blob = encryptSecret('secret')
    expect(() => decryptSecret(`${blob}!`)).toThrow('Invalid encrypted secret')
    expect(() => decryptSecret(blob.replace('v1.', 'v1.!'))).toThrow('Invalid encrypted secret')
  })

  it('reports a missing key instead of a generic failure', () => {
    const blob = encryptSecret('x')
    vi.stubEnv('APP_ENCRYPTION_KEY', '')
    expect(() => encryptSecret('x')).toThrow('Missing env APP_ENCRYPTION_KEY')
    expect(() => decryptSecret(blob)).toThrow('Missing env APP_ENCRYPTION_KEY')
  })
})

describe('assertEncryptionKey', () => {
  it('accepts a 32-byte base64 key', () => {
    expect(() => assertEncryptionKey()).not.toThrow()
  })

  it.each([
    ['missing', ''],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['not base64', 'this is not base64!!'],
    ['hex instead of base64', randomBytes(32).toString('hex')],
  ])('rejects a %s key', (_label, value) => {
    vi.stubEnv('APP_ENCRYPTION_KEY', value)
    expect(() => assertEncryptionKey()).toThrow('APP_ENCRYPTION_KEY')
  })
})
