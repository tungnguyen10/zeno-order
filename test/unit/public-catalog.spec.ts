import { describe, expect, it, vi } from 'vitest'

import {
  createPublicCatalogService,
  mapPublicCatalog,
} from '../../server/domain/catalog/public-catalog'
import { StoreNotFoundError } from '../../server/domain/store/public-store'

const rpcCatalog = {
  store: {
    public_slug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: null,
    logo_path: null,
    cover_path: '/covers/mochi.webp',
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  },
  menus: [{ id: '40000000-0000-0000-0000-000000000001', name: 'Thực đơn chính' }],
  sections: [{
    id: '50000000-0000-0000-0000-000000000001',
    menu_id: '40000000-0000-0000-0000-000000000001',
    name: 'Cà phê',
    slug: 'ca-phe',
    description: null,
  }],
  menu_items: [{
    id: '70000000-0000-0000-0000-000000000001',
    menu_id: '40000000-0000-0000-0000-000000000001',
    section_id: '50000000-0000-0000-0000-000000000001',
    product_id: '60000000-0000-0000-0000-000000000001',
  }],
  products: [{
    id: '60000000-0000-0000-0000-000000000001',
    name: 'Cà phê sữa đá',
    slug: 'ca-phe-sua-da',
    description: 'Đậm vị',
    base_price: '9223372036854775807',
    image_path: null,
  }],
  option_groups: [{
    id: '80000000-0000-0000-0000-000000000001',
    name: 'Kích cỡ',
    selection_type: 'single' as const,
    required: true,
    min_select: 1,
    max_select: 1,
    values: [{
      id: '90000000-0000-0000-0000-000000000001',
      name: 'Nhỏ',
      price_adjustment: '0',
      is_default: true,
    }],
  }],
  product_option_groups: [{
    product_id: '60000000-0000-0000-0000-000000000001',
    option_group_id: '80000000-0000-0000-0000-000000000001',
  }],
}

describe('mapPublicCatalog', () => {
  it('maps nested snake-case data without converting money to number', () => {
    const catalog = mapPublicCatalog(rpcCatalog)

    expect(catalog.store).toEqual({
      publicSlug: 'mochi-cafe',
      name: 'Mochi Cafe',
      description: null,
      logoPath: null,
      coverPath: '/covers/mochi.webp',
      timezone: 'Asia/Ho_Chi_Minh',
      currency: 'VND',
    })
    expect(catalog.products[0]?.basePrice).toBe('9223372036854775807')
    expect(catalog.optionGroups[0]?.values[0]).toEqual({
      id: '90000000-0000-0000-0000-000000000001',
      name: 'Nhỏ',
      priceAdjustment: '0',
      isDefault: true,
    })
    expect(catalog.menuItems.map(item => item.id)).toEqual([
      '70000000-0000-0000-0000-000000000001',
    ])
  })
})

describe('createPublicCatalogService', () => {
  it('rejects invalid and reserved slugs without calling the repository', async () => {
    const findPublicBySlug = vi.fn()
    const service = createPublicCatalogService({ findPublicBySlug })

    await expect(service.resolve('INVALID')).rejects.toBeInstanceOf(StoreNotFoundError)
    await expect(service.resolve('admin')).rejects.toBeInstanceOf(StoreNotFoundError)
    expect(findPublicBySlug).not.toHaveBeenCalled()
  })

  it('maps an empty RPC result to the safe not-found error', async () => {
    const service = createPublicCatalogService({
      findPublicBySlug: async () => null,
    })

    await expect(service.resolve('missing-store')).rejects.toBeInstanceOf(StoreNotFoundError)
  })

  it('preserves database failures for the API boundary', async () => {
    const service = createPublicCatalogService({
      findPublicBySlug: async () => {
        throw new Error('database unavailable')
      },
    })

    await expect(service.resolve('mochi-cafe')).rejects.toThrow('database unavailable')
  })
})
