import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export type SignatureResult = 'OK' | 'MISSING' | 'STALE' | 'MISMATCH'
export type ApiKeyResult = 'OK' | 'MISSING' | 'MISMATCH'

export const SIGNATURE_TOLERANCE_SEC = 300
const API_KEY_PREFIX = 'Apikey '

// Hashing both sides first gives timingSafeEqual equal-length inputs, so length is not leaked either.
function constantTimeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

export function verifySepaySignature(input: {
  rawBody: string
  timestamp: string | undefined
  signatureHeader: string | undefined
  secret: string
  nowSec: number
}): SignatureResult {
  const { rawBody, timestamp, signatureHeader, secret, nowSec } = input
  if (!timestamp || !signatureHeader) return 'MISSING'
  if (!/^\d{1,12}$/.test(timestamp)) return 'STALE'
  if (Math.abs(nowSec - Number(timestamp)) > SIGNATURE_TOLERANCE_SEC) return 'STALE'
  if (!secret) return 'MISMATCH'
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`
  return constantTimeEqual(expected, signatureHeader.trim().toLowerCase()) ? 'OK' : 'MISMATCH'
}

export function verifySepayApiKey(input: { authorizationHeader: string | undefined, apiKey: string }): ApiKeyResult {
  const { authorizationHeader, apiKey } = input
  if (!authorizationHeader) return 'MISSING'
  if (!apiKey || !authorizationHeader.startsWith(API_KEY_PREFIX)) return 'MISMATCH'
  return constantTimeEqual(authorizationHeader.slice(API_KEY_PREFIX.length), apiKey) ? 'OK' : 'MISMATCH'
}
