import { describe, expect, it } from 'vitest'
import { redactPath } from '../../../server/utils/redact-path'
import { safePath } from '../../../server/utils/safe-path'

describe('redactPath (invitation tokens)', () => {
  it.each([
    ['/api/webhooks/sepay/key-123?x=1', '/api/webhooks/sepay/[REDACTED]?x=1'],
    ['/api/public/orders/token-123/payment-attempts', '/api/public/orders/[REDACTED]/payment-attempts'],
    ['/api/invitations/abc123_-XYZ', '/api/invitations/[REDACTED]'],
    ['/api/invitations/abc123_-XYZ/accept', '/api/invitations/[REDACTED]/accept'],
    ['/invite/abc123', '/invite/[REDACTED]'],
    ['/api/stores/11111111-1111-4111-8111-111111111111/team/invitations', '/api/stores/11111111-1111-4111-8111-111111111111/team/invitations'],
    ['/api/public/stores/quan-a/orders', '/api/public/stores/quan-a/orders'],
  ])('%s → %s', (input, expected) => {
    expect(redactPath(input)).toBe(expected)
  })

  it('composes with safePath (PR3): query dropped, order token and invitation token both hidden', () => {
    expect(redactPath(safePath('/api/invitations/abc123_-XYZ/accept?x=1'))).toBe('/api/invitations/[REDACTED]/accept')
    expect(redactPath(safePath('/api/public/orders/tok-en_1'))).toBe('/api/public/orders/[REDACTED]')
  })
})
