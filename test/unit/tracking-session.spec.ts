import { describe, expect, it, vi } from 'vitest'

import { consumeTrackingToken } from '../../app/domain/tracking-session'

describe('consumeTrackingToken', () => {
  it('moves a valid fragment token into scoped session storage and strips the URL', () => {
    const storage = { getItem: vi.fn(), setItem: vi.fn() }
    const replaceUrl = vi.fn()
    const token = 'a'.repeat(43)

    expect(consumeTrackingToken({
      publicSlug: 'mochi-cafe',
      orderNumber: 'A1001',
      hash: `#t=${token}`,
      pathname: '/s/mochi-cafe/order/A1001',
      search: '?from=checkout',
      storage,
      replaceUrl,
    })).toBe(token)
    expect(storage.setItem).toHaveBeenCalledWith('zeno-order:tracking:v1:mochi-cafe:A1001', token)
    expect(replaceUrl).toHaveBeenCalledWith('/s/mochi-cafe/order/A1001?from=checkout')
  })

  it('falls back to an existing scoped token and rejects malformed fragments', () => {
    const storage = { getItem: vi.fn(() => 'b'.repeat(43)), setItem: vi.fn() }
    const replaceUrl = vi.fn()
    expect(consumeTrackingToken({
      publicSlug: 'mochi-cafe', orderNumber: 'A1001', hash: '#t=raw token',
      pathname: '/track', search: '', storage, replaceUrl,
    })).toBe('b'.repeat(43))
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(replaceUrl).toHaveBeenCalledWith('/track')
  })
})
