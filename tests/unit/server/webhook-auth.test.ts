import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { authenticateWebhook } from '../../../server/services/payments/webhook-auth'

const NOW = 1_800_000_000
const BODY = '{"id":1}'
const sig = (secret: string, ts = NOW) => `sha256=${createHmac('sha256', secret).update(`${ts}.${BODY}`).digest('hex')}`

describe('authenticateWebhook', () => {
  it('HMAC mode accepts a valid signature and ignores the Authorization header', () => {
    expect(authenticateWebhook({
      mode: 'HMAC', secret: 's', rawBody: BODY, nowSec: NOW,
      headers: { signature: sig('s'), timestamp: String(NOW), authorization: 'Apikey whatever' },
    })).toBe('OK')
  })

  it('HMAC mode rejects an API-key-only request as MISSING', () => {
    expect(authenticateWebhook({ mode: 'HMAC', secret: 's', rawBody: BODY, nowSec: NOW, headers: { authorization: 'Apikey s' } })).toBe('MISSING')
  })

  it('APIKEY mode accepts "Apikey <key>" and ignores any signature headers', () => {
    expect(authenticateWebhook({
      mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW,
      headers: { authorization: 'Apikey k', signature: 'sha256=bad', timestamp: '1' },
    })).toBe('OK')
  })

  it('APIKEY mode rejects a validly signed request without Authorization (no downgrade confusion)', () => {
    expect(authenticateWebhook({
      mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW,
      headers: { signature: sig('k'), timestamp: String(NOW) },
    })).toBe('MISSING')
  })

  it('APIKEY mode rejects a wrong key', () => {
    expect(authenticateWebhook({ mode: 'APIKEY', secret: 'k', rawBody: BODY, nowSec: NOW, headers: { authorization: 'Apikey nope' } })).toBe('MISMATCH')
  })
})
