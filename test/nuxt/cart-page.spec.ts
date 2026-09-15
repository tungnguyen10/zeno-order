import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CartPage from '../../app/pages/s/[publicSlug]/cart.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

const store = {
  publicSlug: 'mochi-cafe',
  name: 'Mochi Cafe',
  description: null,
  logoPath: null,
  timezone: 'Asia/Ho_Chi_Minh',
  currency: 'VND',
}

const persistedCart = {
  version: 1,
  publicSlug: 'mochi-cafe',
  currency: 'VND',
  items: [{
    id: 'line-1',
    productId: 'product-1',
    productName: 'Cà phê sữa đá',
    basePrice: '35000',
    options: [{
      optionGroupId: 'size',
      optionGroupName: 'Kích cỡ',
      optionValueId: 'large',
      optionValueName: 'Lớn',
      priceAdjustment: '5000',
    }],
    quantity: 2,
    note: 'Ít đá',
  }],
}

describe('cart page', () => {
  beforeEach(() => {
    useFetchMock.mockReset()
    localStorage.clear()
    useFetchMock.mockResolvedValue({ data: ref(store), error: ref(null) })
  })

  it('renders an empty store-scoped cart with a recovery link', async () => {
    const wrapper = await mountSuspended(CartPage, {
      route: '/s/mochi-cafe/cart',
    })

    expect(wrapper.get('h1').text()).toBe('Giỏ hàng')
    expect(wrapper.text()).toContain('Giỏ hàng đang trống')
    expect(wrapper.get('[data-menu-link]').attributes('href')).toBe('/s/mochi-cafe')
    expect(wrapper.find('[data-checkout-link]').exists()).toBe(false)
  })

  it('updates and removes a persisted line while deriving the subtotal', async () => {
    localStorage.setItem('zeno-order:cart:v1:mochi-cafe', JSON.stringify(persistedCart))
    const wrapper = await mountSuspended(CartPage, {
      route: '/s/mochi-cafe/cart',
    })

    expect(wrapper.get('[data-cart-item]').text()).toContain('Cà phê sữa đá')
    expect(wrapper.get('[data-cart-item]').text()).toContain('Lớn')
    expect(wrapper.get('[data-cart-item]').text()).toContain('Ít đá')
    expect(wrapper.get('[data-cart-subtotal]').text()).toContain('80.000 ₫')
    expect(wrapper.get('[data-checkout-link]').attributes('href')).toBe('/s/mochi-cafe/checkout')

    await wrapper.get('[aria-label="Tăng số lượng Cà phê sữa đá"]').trigger('click')
    expect(wrapper.get('[data-cart-subtotal]').text()).toContain('120.000 ₫')
    expect(JSON.parse(localStorage.getItem('zeno-order:cart:v1:mochi-cafe')!).items[0].quantity).toBe(3)

    await wrapper.get('[aria-label="Xóa Cà phê sữa đá khỏi giỏ hàng"]').trigger('click')
    expect(wrapper.text()).toContain('Giỏ hàng đang trống')
    expect(localStorage.getItem('zeno-order:cart:v1:mochi-cafe')).toBeNull()
  })
})
