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

describe('checkout shell', () => {
  beforeEach(() => {
    useFetchMock.mockReset()
    localStorage.clear()
    useFetchMock.mockResolvedValue({ data: ref(store), error: ref(null) })
  })

  it('shows the local summary without exposing an order submission', async () => {
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
    expect(wrapper.text()).toContain('Đặt đơn sẽ được mở ở R4')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.find('button[type="submit"]').exists()).toBe(false)
    expect(wrapper.get('[data-cart-link]').attributes('href')).toBe('/s/mochi-cafe/cart')
    expect(useFetchMock).toHaveBeenCalledTimes(1)
  })

  it('redirects an empty checkout shell back to the same store cart', async () => {
    const wrapper = await mountSuspended(CheckoutPage, {
      route: '/s/mochi-cafe/checkout',
    })

    expect(wrapper.text()).toContain('Chưa có món để thanh toán')
    expect(wrapper.get('[data-cart-link]').attributes('href')).toBe('/s/mochi-cafe/cart')
  })
})
