import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

type JsonPrimitive = boolean | null | number | string
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

function serializeCanonical(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value)
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError('Value cannot be represented as canonical JSON')
    }
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(entry => serializeCanonical(entry)).join(',')}]`
  }

  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Value cannot be represented as canonical JSON')
    }

    const record = value as Record<string, unknown>
    const entries = Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${serializeCanonical(record[key])}`)
    return `{${entries.join(',')}}`
  }

  throw new TypeError('Value cannot be represented as canonical JSON')
}

export function canonicalJson(value: JsonValue | unknown): string {
  return serializeCanonical(value)
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

interface TrackingTokenInput {
  secret: string
  keyVersion: number
  storeId: string
  orderId: string
  idempotencyKey: string
}

interface TrackingTokenResult {
  keyVersion: number
  token: string
  tokenHash: string
}

export function createTrackingToken(input: TrackingTokenInput): TrackingTokenResult {
  if (
    input.secret.length < 32
    || !Number.isInteger(input.keyVersion)
    || input.keyVersion < 1
    || !input.storeId
    || !input.orderId
    || !input.idempotencyKey
  ) {
    throw new TypeError('Invalid tracking token input')
  }

  const message = `${input.storeId}:${input.orderId}:${input.idempotencyKey}`
  const token = createHmac('sha256', input.secret).update(message, 'utf8').digest('base64url')

  return {
    keyVersion: input.keyVersion,
    token,
    tokenHash: sha256Hex(token),
  }
}

export function trackingTokenMatchesHash(token: string, expectedHash: string): boolean {
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    return false
  }

  const actual = Buffer.from(sha256Hex(token), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
