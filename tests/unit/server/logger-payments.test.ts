import { describe, expect, it } from 'vitest'
import { logger, redact } from '../../../server/utils/logger'
import { captureConsole, expectNoneOf } from '../../support/leaks'

describe('redact: payment secrets', () => {
  it.each([
    'hmacSecret', 'apiToken', 'encryptedHmacSecret', 'encryptedApiToken',
    'webhookEndpointKey', 'endpointKey', 'endpoint_key', 'endpoint-key',
  ])('masks the key %s', (key) => {
    expect(redact({ [key]: 'value', ok: 1 })).toEqual({ [key]: '[REDACTED]', ok: 1 })
  })
})

describe('redact: sensitive paths inside strings', () => {
  it('masks the webhook endpoint key but keeps the rest of the message', () => {
    expect(redact('POST /api/webhooks/sepay/AbC_dEf-1234567890abcdefghijkl failed'))
      .toBe('POST /api/webhooks/sepay/[REDACTED] failed')
  })

  it('stops at the query string', () => {
    expect(redact({ path: '/api/webhooks/sepay/KEY123?x=1' })).toEqual({ path: '/api/webhooks/sepay/[REDACTED]?x=1' })
  })

  it('masks the guest token in order paths, including the payment-attempts sub-route', () => {
    expect(redact('/api/public/orders/Tok_en-0123456789')).toBe('/api/public/orders/[REDACTED]')
    expect(redact('/api/public/orders/Tok_en-0123456789/payment-attempts')).toBe('/api/public/orders/[REDACTED]/payment-attempts')
  })

  it('leaves unrelated paths untouched', () => {
    expect(redact('/api/public/stores/tra-sua/menu')).toBe('/api/public/stores/tra-sua/menu')
    expect(redact('/api/webhooks/other/abc')).toBe('/api/webhooks/other/abc')
  })
})

describe('logger output', () => {
  it('never prints a secret, endpoint key or guest token passed in the context', () => {
    const capture = captureConsole()
    try {
      logger.error('api.unhandled', {
        path: '/api/webhooks/sepay/ENDPOINTKEY0123456789abcdefghij',
        order: '/api/public/orders/GUESTTOKEN0123456789abcdefghijklmnopqrstu/payment-attempts',
        hmacSecret: 'SENTINEL_HMAC_VALUE',
        nested: { apiToken: 'SENTINEL_API_TOKEN' },
        err: new Error('boom'),
      })
    }
    finally {
      capture.restore()
    }
    expectNoneOf(capture.text(), [
      'ENDPOINTKEY0123456789abcdefghij',
      'GUESTTOKEN0123456789abcdefghijklmnopqrstu',
      'SENTINEL_HMAC_VALUE',
      'SENTINEL_API_TOKEN',
    ])
    expect(capture.text()).toContain('[REDACTED]')
  })
})

it('redacts bearer paths in the log message itself', () => {
  const capture = captureConsole()
  try {
    logger.warn('GET /api/public/orders/guest-bearer/payment-attempts')
    logger.error('POST /api/webhooks/sepay/endpoint-bearer failed')
  }
  finally { capture.restore() }
  expectNoneOf(capture.text(), ['guest-bearer', 'endpoint-bearer'])
})
