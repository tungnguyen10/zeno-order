import { describe, expect, it, vi } from 'vitest'

import { createCheckoutAttemptManager } from '../../app/domain/checkout-attempt'

describe('createCheckoutAttemptManager', () => {
  it('reuses one key for an unchanged payload and rotates when it changes', () => {
    const createUuid = vi.fn()
      .mockReturnValueOnce('d1000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('d1000000-0000-4000-8000-000000000002')
    const manager = createCheckoutAttemptManager(createUuid)

    expect(manager.keyFor('same-payload')).toBe('d1000000-0000-4000-8000-000000000001')
    expect(manager.keyFor('same-payload')).toBe('d1000000-0000-4000-8000-000000000001')
    expect(manager.keyFor('changed-payload')).toBe('d1000000-0000-4000-8000-000000000002')
    expect(createUuid).toHaveBeenCalledTimes(2)
  })

  it('starts a fresh attempt after reset', () => {
    const createUuid = vi.fn()
      .mockReturnValueOnce('d1000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('d1000000-0000-4000-8000-000000000002')
    const manager = createCheckoutAttemptManager(createUuid)

    manager.keyFor('payload')
    manager.reset()
    expect(manager.keyFor('payload')).toBe('d1000000-0000-4000-8000-000000000002')
  })
})
