import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CheckoutPage from '../../app/pages/s/[publicSlug]/checkout.vue'

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

describe('checkout page', () => {
  beforeEach(() => {
    useFetchMock.mockReset()
    localStorage.clear()
    useFetchMock.mockResolvedValue({ data: ref(store), error: ref(null) })
  })

  it('shows the local summary and real order form', async () => {
    localStorage.setItem('zeno-order:cart:v1:mochi-cafe', JSON.stringify({
      version: 1,
      publicSlug: 'mochi-cafe',
      currency: 'VND',
      items: [{
        id: 'line-1',
        productId: 'product-1',
        productName: 'Cà phê sữa đá',
        basePrice: '35000',
        options: [],
        quantity: 2,
        note: '',
      }],
    }))

    const wrapper = await mountSuspended(CheckoutPage, {
      route: '/s/mochi-cafe/checkout',
    })

    expect(wrapper.get('h1').text()).toBe('Thanh toán')
    expect(wrapper.text()).toContain('Cà phê sữa đá')
    expect(wrapper.get('[data-checkout-total]').text()).toContain('70.000 ₫')
    expect(wrapper.find('form').exists()).toBe(true)
    expect(wrapper.get('button[type="submit"]').text()).toContain('Đặt đơn')
    expect(wrapper.get('[data-cart-link]').attributes('href')).toBe('/s/mochi-cafe/cart')
    expect(useFetchMock).toHaveBeenCalledTimes(1)
  })

  it('directs an empty checkout back to the same store cart', async () => {
    const wrapper = await mountSuspended(CheckoutPage, {
      route: '/s/mochi-cafe/checkout',
    })

    expect(wrapper.text()).toContain('Chưa có món để thanh toán')
    expect(wrapper.get('[data-cart-link]').attributes('href')).toBe('/s/mochi-cafe/cart')
  })
})
