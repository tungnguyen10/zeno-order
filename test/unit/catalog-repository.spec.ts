import { describe, expect, it, vi } from 'vitest'

import { createCatalogRepository } from '../../server/repositories/catalog.repository'

const rpcCatalog = {
  store: {
    public_slug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: null,
    logo_path: null,
    cover_path: null,
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  },
  menus: [],
  sections: [],
  menu_items: [],
  products: [],
  option_groups: [],
  product_option_groups: [],
}

describe('createCatalogRepository', () => {
  it('calls only the public catalog RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rpcCatalog, error: null })
    const repository = createCatalogRepository({ rpc })

    await expect(repository.findPublicBySlug('mochi-cafe')).resolves.toEqual(rpcCatalog)
    expect(rpc).toHaveBeenCalledWith('get_storefront_catalog_by_slug', {
      p_public_slug: 'mochi-cafe',
    })
  })

  it('returns null for an empty RPC result', async () => {
    const repository = createCatalogRepository({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    })

    await expect(repository.findPublicBySlug('missing-store')).resolves.toBeNull()
  })

  it('does not hide database failures', async () => {
    const repository = createCatalogRepository({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'database unavailable' },
      }),
    })

    await expect(repository.findPublicBySlug('mochi-cafe')).rejects.toThrow('database unavailable')
  })
})
