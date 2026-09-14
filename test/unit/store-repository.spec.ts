import { describe, expect, it, vi } from 'vitest'

import { createStoreRepository } from '../../server/repositories/store.repository'

describe('createStoreRepository', () => {
  it('uses only the safe public resolver RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        public_slug: 'mochi-cafe',
        name: 'Mochi Cafe',
        description: null,
        logo_path: null,
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
      }],
      error: null,
    })
    const repository = createStoreRepository({ rpc })

    await expect(repository.findPublicBySlug('mochi-cafe')).resolves.toMatchObject({
      public_slug: 'mochi-cafe',
    })
    expect(rpc).toHaveBeenCalledWith('get_public_store_by_slug', {
      p_public_slug: 'mochi-cafe',
    })
  })

  it('returns null when the RPC has no matching row', async () => {
    const repository = createStoreRepository({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    await expect(repository.findPublicBySlug('missing-store')).resolves.toBeNull()
  })

  it('does not hide database failures', async () => {
    const repository = createStoreRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      }),
    })

    await expect(repository.findPublicBySlug('mochi-cafe')).rejects.toThrow('database unavailable')
  })
})
