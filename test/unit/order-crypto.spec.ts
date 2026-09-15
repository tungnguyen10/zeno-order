import { describe, expect, it } from 'vitest'

import {
  canonicalJson,
  createTrackingToken,
  sha256Hex,
  trackingTokenMatchesHash,
} from '../../server/utils/order-crypto'

describe('canonicalJson', () => {
  it('sorts object keys recursively without reordering arrays', () => {
    expect(canonicalJson({
      z: 1,
      a: { y: true, x: ['two', null] },
    })).toBe('{"a":{"x":["two",null],"y":true},"z":1}')
  })

  it.each([
    { invalid: undefined },
    { invalid: Number.NaN },
    { invalid: new Date('2026-09-15T00:00:00Z') },
  ])('rejects values outside the JSON data model %#', ({ invalid }) => {
    expect(() => canonicalJson(invalid)).toThrow('canonical JSON')
  })
})

describe('order crypto', () => {
  it('produces the same request hash for equivalent object key order', () => {
    expect(sha256Hex(canonicalJson({ b: 2, a: 1 })))
      .toBe(sha256Hex(canonicalJson({ a: 1, b: 2 })))
  })

  it('derives a reproducible versioned tracking token and stored hash', () => {
    const input = {
      secret: 'tracking-secret-that-is-at-least-32-bytes',
      keyVersion: 3,
      storeId: '21000000-0000-0000-0000-000000000001',
      orderId: 'a1000000-0000-4000-8000-000000000001',
      idempotencyKey: 'e1000000-0000-4000-8000-000000000001',
    }

    const first = createTrackingToken(input)
    const retry = createTrackingToken(input)

    expect(first).toEqual(retry)
    expect(first.keyVersion).toBe(3)
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(trackingTokenMatchesHash(first.token, first.tokenHash)).toBe(true)
    expect(trackingTokenMatchesHash(`${first.token}x`, first.tokenHash)).toBe(false)
    expect(trackingTokenMatchesHash(first.token, 'not-a-hash')).toBe(false)
  })

  it('binds the tracking token to every order identity input', () => {
    const base = {
      secret: 'tracking-secret-that-is-at-least-32-bytes',
      keyVersion: 1,
      storeId: '21000000-0000-0000-0000-000000000001',
      orderId: 'a1000000-0000-4000-8000-000000000001',
      idempotencyKey: 'e1000000-0000-4000-8000-000000000001',
    }
    const token = createTrackingToken(base).token

    expect(createTrackingToken({ ...base, storeId: '21000000-0000-0000-0000-000000000002' }).token).not.toBe(token)
    expect(createTrackingToken({ ...base, orderId: 'a1000000-0000-4000-8000-000000000002' }).token).not.toBe(token)
    expect(createTrackingToken({ ...base, idempotencyKey: 'e1000000-0000-4000-8000-000000000002' }).token).not.toBe(token)
  })
})
