import { describe, expect, it } from 'vitest'

import { parseOrderServerEnvironment } from '../../server/utils/order-environment'

describe('parseOrderServerEnvironment', () => {
  it('parses server-only checkout secrets and limits', () => {
    expect(parseOrderServerEnvironment({
      supabaseSecretKey: 'sb_secret_local_test_key_1234567890',
      turnstileSecretKey: 'turnstile-secret-key-for-local-testing',
      rateLimitMax: 8,
      rateLimitWindowSeconds: 60,
      trackingKeyVersion: 2,
      trackingSecretsJson: JSON.stringify({
        1: 'old-tracking-secret-that-is-at-least-32-bytes',
        2: 'current-tracking-secret-that-is-at-least-32-bytes',
      }),
    })).toEqual({
      supabaseSecretKey: 'sb_secret_local_test_key_1234567890',
      turnstileSecretKey: 'turnstile-secret-key-for-local-testing',
      rateLimitMax: 8,
      rateLimitWindowSeconds: 60,
      trackingKeyVersion: 2,
      trackingSecrets: {
        1: 'old-tracking-secret-that-is-at-least-32-bytes',
        2: 'current-tracking-secret-that-is-at-least-32-bytes',
      },
    })
  })

  it('accepts structured tracking secrets deserialized by runtime config', () => {
    expect(parseOrderServerEnvironment({
      supabaseSecretKey: 'sb_secret_local_test_key_1234567890',
      turnstileSecretKey: 'turnstile-secret-key-for-local-testing',
      rateLimitMax: 8,
      rateLimitWindowSeconds: 60,
      trackingKeyVersion: 1,
      trackingSecretsJson: {
        1: 'tracking-secret-that-is-at-least-32-bytes',
      },
    }).trackingSecrets).toEqual({
      1: 'tracking-secret-that-is-at-least-32-bytes',
    })
  })

  it.each([
    { trackingKeyVersion: 2, trackingSecretsJson: '{"1":"tracking-secret-that-is-at-least-32-bytes"}' },
    { rateLimitMax: 0 },
    { rateLimitWindowSeconds: 0 },
    { turnstileSecretKey: '' },
    { trackingSecretsJson: 'not-json' },
  ])('rejects unsafe server configuration %#', (override) => {
    expect(() => parseOrderServerEnvironment({
      supabaseSecretKey: 'sb_secret_local_test_key_1234567890',
      turnstileSecretKey: 'turnstile-secret-key-for-local-testing',
      rateLimitMax: 8,
      rateLimitWindowSeconds: 60,
      trackingKeyVersion: 1,
      trackingSecretsJson: '{"1":"tracking-secret-that-is-at-least-32-bytes"}',
      ...override,
    })).toThrow('Invalid order server runtime configuration')
  })
})
