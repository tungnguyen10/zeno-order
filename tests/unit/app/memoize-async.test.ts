import { describe, expect, it, vi } from 'vitest'
import { memoizeAsync } from '../../../app/utils/memoize-async'

describe('memoizeAsync', () => {
  it('runs the loader once and shares the result', async () => {
    const loader = vi.fn().mockResolvedValue('client')
    const get = memoizeAsync(loader)
    const [a, b] = await Promise.all([get(), get()])
    expect(a).toBe('client')
    expect(b).toBe('client')
    expect(await get()).toBe('client')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed load instead of caching the rejection', async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce('client')
    const get = memoizeAsync(loader)
    await expect(get()).rejects.toThrow('chunk failed')
    expect(await get()).toBe('client')
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
