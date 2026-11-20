import { describe, expect, it } from 'vitest'
import { pushSubscriptionSchema, pushUnsubscribeSchema } from '#shared/schemas/push'

const valid = { endpoint: 'https://push.example.com/abc123', keys: { p256dh: 'BPk...', auth: 'xYz' } }

describe('pushSubscriptionSchema', () => {
  it('accepts a well-formed subscription', () => {
    expect(pushSubscriptionSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects a non-URL endpoint', () => {
    expect(pushSubscriptionSchema.safeParse({ ...valid, endpoint: 'not-a-url' }).success).toBe(false)
  })

  it('rejects missing keys', () => {
    expect(pushSubscriptionSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(false)
    expect(pushSubscriptionSchema.safeParse({ ...valid, keys: { p256dh: '', auth: '' } }).success).toBe(false)
  })
})

describe('pushUnsubscribeSchema', () => {
  it('requires a URL endpoint', () => {
    expect(pushUnsubscribeSchema.safeParse({ endpoint: valid.endpoint }).success).toBe(true)
    expect(pushUnsubscribeSchema.safeParse({ endpoint: '' }).success).toBe(false)
  })
})
