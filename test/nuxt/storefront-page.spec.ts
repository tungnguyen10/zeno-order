import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import StorefrontPage from '../../app/pages/s/[publicSlug]/index.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

const catalog = {
  store: {
    publicSlug: 'mochi-cafe',
    name: 'Mochi Cafe',
    description: 'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
    logoPath: null,
    coverPath: null,
    timezone: 'Asia/Ho_Chi_Minh',
    currency: 'VND',
  },
  menus: [{ id: 'menu-1', name: 'Thực đơn chính' }],
  sections: [
    { id: 'section-1', menuId: 'menu-1', name: 'Cà phê', slug: 'ca-phe', description: null },
    { id: 'section-2', menuId: 'menu-1', name: 'Bánh ngọt', slug: 'banh-ngot', description: null },
    { id: 'section-empty', menuId: 'menu-1', name: 'Mục trống', slug: 'muc-trong', description: null },
  ],
  menuItems: [
    { id: 'item-1', menuId: 'menu-1', sectionId: 'section-1', productId: 'product-1' },
    { id: 'item-2', menuId: 'menu-1', sectionId: 'section-2', productId: 'product-2' },
    { id: 'item-3', menuId: 'menu-1', sectionId: 'section-2', productId: 'product-3' },
  ],
  products: [
    { id: 'product-1', name: 'Cà phê sữa đá', slug: 'ca-phe-sua-da', description: 'Đậm vị', basePrice: '35000', imagePath: null },
    { id: 'product-2', name: 'Mochi dâu', slug: 'mochi-dau', description: null, basePrice: '29000', imagePath: null },
    { id: 'product-3', name: 'Món thiếu trạng thái', slug: 'missing-state', description: null, basePrice: '10000', imagePath: null },
  ],
  optionGroups: [{
    id: 'size',
    name: 'Kích cỡ',
    selectionType: 'single' as const,
    required: true,
    minSelect: 1,
    maxSelect: 1,
    values: [{ id: 'small', name: 'Nhỏ', priceAdjustment: '0', isDefault: true }],
  }],
  productOptionGroups: [{ productId: 'product-1', optionGroupId: 'size' }],
}

const availability = {
  publicSlug: 'mochi-cafe',
  status: 'open' as const,
  orderingEnabled: true,
  fulfillment: { delivery: true, pickup: true },
  nextOpeningAt: null,
  products: [
    { productId: 'product-1', isAvailable: true },
    { productId: 'product-2', isAvailable: false },
  ],
}

describe('storefront catalog page', () => {
  beforeEach(() => {
    useFetchMock.mockReset()
    localStorage.clear()
  })

  it('SSR-renders ordered sections, products, money and fresh availability', async () => {
    useFetchMock
      .mockResolvedValueOnce({ data: ref(catalog), error: ref(null) })
      .mockResolvedValueOnce({ data: ref(availability), error: ref(null) })

    const wrapper = await mountSuspended(StorefrontPage, {
      route: '/s/mochi-cafe',
    })

    expect(wrapper.get('h1').text()).toBe('Mochi Cafe')
    expect(wrapper.text()).toContain('Đang mở cửa')
    expect(wrapper.text()).toContain('35.000 ₫')
    expect(wrapper.text()).toContain('Mochi dâu')
    expect(wrapper.text()).toContain('Tạm hết món')
    expect(wrapper.text()).toContain('Món thiếu trạng thái')
    expect(wrapper.text()).not.toContain('Mục trống')
    expect(wrapper.findAll('[data-storefront-section]').map(node => node.attributes('id'))).toEqual([
      'ca-phe',
      'banh-ngot',
    ])
    expect(wrapper.findAll('[data-product-card]').map(node => node.text())).toEqual([
      expect.stringContaining('Cà phê sữa đá'),
      expect.stringContaining('Mochi dâu'),
      expect.stringContaining('Món thiếu trạng thái'),
    ])
    const productCards = wrapper.findAll('[data-product-card]')
    expect(productCards[0]?.get('button').attributes('disabled')).toBeUndefined()
    expect(productCards[1]?.get('button').attributes('disabled')).toBeDefined()
    expect(productCards[2]?.get('button').attributes('disabled')).toBeDefined()

    await productCards[0]?.get('button').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Cà phê sữa đá')
    await wrapper.get('[role="dialog"] form').trigger('submit')
    expect(wrapper.text()).toContain('1 món')
    expect(wrapper.get('[data-cart-bar]').attributes('href')).toBe('/s/mochi-cafe/cart')
    expect(localStorage.getItem('zeno-order:cart:v1:mochi-cafe')).toContain('product-1')

    expect(useFetchMock).toHaveBeenNthCalledWith(1, '/api/storefront/mochi-cafe/catalog', {
      key: 'storefront-catalog:mochi-cafe',
    }, expect.any(String))
    expect(useFetchMock).toHaveBeenNthCalledWith(2, '/api/storefront/mochi-cafe/availability', {
      key: 'storefront-availability:mochi-cafe',
    }, expect.any(String))
  })

  it('preserves an upstream server failure as a 500', async () => {
    useFetchMock
      .mockResolvedValueOnce({ data: ref(null), error: ref({ statusCode: 500 }) })
      .mockResolvedValueOnce({ data: ref(null), error: ref({ statusCode: 500 }) })

    await expect(mountSuspended(StorefrontPage, {
      route: '/s/mochi-cafe',
    })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Không thể tải thông tin cửa hàng.',
    })
  })
})
