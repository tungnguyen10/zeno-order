import { describe, expect, it } from 'vitest'
import { safePath } from '../../../server/utils/safe-path'

describe('safePath', () => {
  it.each([
    ['/api/public/orders/abc_DEF-123xyz?cache=1', '/api/public/orders/[REDACTED]'],
    ['/api/public/orders/abc_DEF-123xyz', '/api/public/orders/[REDACTED]'],
    ['/o/abc_DEF-123xyz', '/o/[REDACTED]'],
    ['/api/webhooks/sepay/endpointKey_123', '/api/webhooks/sepay/[REDACTED]'],
    ['/api/public/stores/quan-a/orders', '/api/public/stores/quan-a/orders'],
    ['/api/health?token=secret', '/api/health'],
    ['/api/stores/3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34', '/api/stores/3f6c1a52-8d0e-4b7a-9c11-2e5d7f0a9b34'],
  ])('%s → %s', (input, expected) => {
    expect(safePath(input)).toBe(expected)
  })
})
