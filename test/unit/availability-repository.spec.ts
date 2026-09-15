import { describe, expect, it, vi } from 'vitest'

import { createAvailabilityRepository } from '../../server/repositories/availability.repository'

const rpcAvailability = {
  public_slug: 'mochi-cafe',
  timezone: 'Asia/Ho_Chi_Minh',
  manual_open_state: null,
  delivery_enabled: true,
  pickup_enabled: true,
  hours: [],
  products: [],
}

describe('createAvailabilityRepository', () => {
  it('calls only the public availability RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcAvailability, error: null })
    const repository = createAvailabilityRepository({ rpc })

    await expect(repository.findPublicBySlug('mochi-cafe')).resolves.toEqual(rpcAvailability)
    expect(rpc).toHaveBeenCalledWith('get_storefront_availability_by_slug', {
      p_public_slug: 'mochi-cafe',
    })
  })

  it('returns null for an empty result and propagates database failures', async () => {
    const emptyRepository = createAvailabilityRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    const failedRepository = createAvailabilityRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'database unavailable' } }),
    })

    await expect(emptyRepository.findPublicBySlug('missing-store')).resolves.toBeNull()
    await expect(failedRepository.findPublicBySlug('mochi-cafe')).rejects.toThrow('database unavailable')
  })
})
