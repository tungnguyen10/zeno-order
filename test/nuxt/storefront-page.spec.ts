import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import StorefrontPage from '../../app/pages/s/[publicSlug]/index.vue'

const { useFetchMock } = vi.hoisted(() => ({
  useFetchMock: vi.fn(),
}))

mockNuxtImport('useFetch', () => useFetchMock)

describe('storefront store shell', () => {
  it('SSR-renders public store data from the Nitro endpoint', async () => {
    useFetchMock.mockResolvedValue({
      data: ref({
        publicSlug: 'mochi-cafe',
        name: 'Mochi Cafe',
        description: 'Cà phê và món ngon được chuẩn bị tươi mỗi ngày.',
        logoPath: null,
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
      }),
      error: ref(null),
    })

    const wrapper = await mountSuspended(StorefrontPage, {
      route: '/s/mochi-cafe',
    })

    expect(wrapper.get('h1').text()).toBe('Mochi Cafe')
    expect(wrapper.text()).toContain('Cà phê và món ngon được chuẩn bị tươi mỗi ngày.')
    expect(wrapper.text()).toContain('Thực đơn sắp được cập nhật')
    expect(useFetchMock).toHaveBeenCalledWith('/api/storefront/mochi-cafe', {
      key: 'public-store:mochi-cafe',
    }, expect.any(String))
  })

  it('preserves an upstream server failure as a 500', async () => {
    useFetchMock.mockResolvedValue({
      data: ref(null),
      error: ref({ statusCode: 500 }),
    })

    await expect(mountSuspended(StorefrontPage, {
      route: '/s/mochi-cafe',
    })).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Không thể tải thông tin cửa hàng.',
    })
  })
})
