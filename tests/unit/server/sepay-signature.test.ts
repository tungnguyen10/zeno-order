import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { SIGNATURE_TOLERANCE_SEC, verifySepayApiKey, verifySepaySignature } from '../../../server/services/payments/sepay-signature'

const SECRET = 'whsec_unit_test_secret'
const NOW = 1_800_000_000
const BODY = '{"id":92704,"transferAmount":5000000,"content":"ZOABCD1234 chuyển tiền"}'

function sign(body: string, timestamp: number, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
}

function verify(overrides: Partial<Parameters<typeof verifySepaySignature>[0]> = {}) {
  return verifySepaySignature({
    rawBody: BODY,
    timestamp: String(NOW),
    signatureHeader: sign(BODY, NOW),
    secret: SECRET,
    nowSec: NOW,
    ...overrides,
  })
}

describe('verifySepaySignature', () => {
  it('accepts a correctly signed raw body (non-ASCII included)', () => {
    expect(verify()).toBe('OK')
  })

  it('accepts uppercase hex and a timestamp at the edge of the window', () => {
    expect(verify({ signatureHeader: sign(BODY, NOW).toUpperCase().replace('SHA256=', 'sha256=') })).toBe('OK')
    expect(verify({ timestamp: String(NOW - SIGNATURE_TOLERANCE_SEC), signatureHeader: sign(BODY, NOW - SIGNATURE_TOLERANCE_SEC) })).toBe('OK')
  })

  it('reports MISSING when either header is absent or empty', () => {
    expect(verify({ timestamp: undefined })).toBe('MISSING')
    expect(verify({ signatureHeader: undefined })).toBe('MISSING')
    expect(verify({ signatureHeader: '' })).toBe('MISSING')
  })

  it('reports STALE outside ±300 s, in both directions, and for non-numeric timestamps', () => {
    const past = NOW - SIGNATURE_TOLERANCE_SEC - 1
    const future = NOW + SIGNATURE_TOLERANCE_SEC + 1
    expect(verify({ timestamp: String(past), signatureHeader: sign(BODY, past) })).toBe('STALE')
    expect(verify({ timestamp: String(future), signatureHeader: sign(BODY, future) })).toBe('STALE')
    expect(verify({ timestamp: 'abc' })).toBe('STALE')
  })

  it('reports MISMATCH when the body, secret, prefix or timestamp differ', () => {
    expect(verify({ rawBody: `${BODY} ` })).toBe('MISMATCH')
    expect(verify({ rawBody: JSON.stringify(JSON.parse(BODY), null, 1) })).toBe('MISMATCH')
    expect(verify({ secret: 'other' })).toBe('MISMATCH')
    expect(verify({ signatureHeader: sign(BODY, NOW).slice('sha256='.length) })).toBe('MISMATCH')
    expect(verify({ signatureHeader: sign(BODY, NOW - 1) })).toBe('MISMATCH')
    expect(verify({ signatureHeader: 'sha256=00' })).toBe('MISMATCH')
  })

  it('never accepts an empty secret', () => {
    expect(verify({ secret: '', signatureHeader: sign(BODY, NOW, '') })).toBe('MISMATCH')
  })
})

describe('verifySepayApiKey', () => {
  it('accepts "Apikey <key>"', () => {
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-123', apiKey: 'k-123' })).toBe('OK')
  })

  it('reports MISSING without a header', () => {
    expect(verifySepayApiKey({ authorizationHeader: undefined, apiKey: 'k-123' })).toBe('MISSING')
    expect(verifySepayApiKey({ authorizationHeader: '', apiKey: 'k-123' })).toBe('MISSING')
  })

  it('reports MISMATCH for another scheme, key, or an empty configured key', () => {
    expect(verifySepayApiKey({ authorizationHeader: 'Bearer k-123', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-124', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey k-1234', apiKey: 'k-123' })).toBe('MISMATCH')
    expect(verifySepayApiKey({ authorizationHeader: 'Apikey ', apiKey: '' })).toBe('MISMATCH')
  })
})
