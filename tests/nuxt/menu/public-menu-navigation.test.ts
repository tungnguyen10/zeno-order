import type { PublicFulfillment, PublicMenu } from '#shared/types/catalog'
import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { nextTick, reactive, shallowRef, toValue, type MaybeRefOrGetter } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PublicMenuPage from '~/pages/s/[slug].vue'

interface TestRoute {
  params: { slug: string }
  query: Record<string, string | undefined>
}

const mocks = vi.hoisted(() => ({
  route: { value: null as TestRoute | null },
  fetch: vi.fn(),
}))

mockNuxtImport('useRoute', () => () => mocks.route.value!)
mockNuxtImport('useFetch', () => mocks.fetch)

const menu: PublicMenu = {
  store: { name: 'Quán A', slug: 'store-a', isAcceptingOrders: true, logoUrl: null },
  modes: { dineIn: true, pickup: true, delivery: { enabled: false, available: false } },
  categories: [],
  products: [],
}

describe('public menu fulfillment navigation', () => {
  beforeEach(() => {
    mocks.route.value = reactive<TestRoute>({ params: { slug: 'store-a' }, query: { t: 'token-a' } })
  })

  it('clears the previous table on store change and refreshes with the current slug and token', async () => {
    const menuData = shallowRef<PublicMenu | null>(menu)
    const fulfillmentData = shallowRef<PublicFulfillment | null>({
      modes: menu.modes,
      deliveryZones: [],
      table: { displayName: 'Bàn A' },
      tableError: null,
    })
    const requests: { url: string, token: string | undefined }[] = []

    mocks.fetch.mockImplementation(async (url: string | (() => string), options: { query?: MaybeRefOrGetter<{ t?: string }> } = {}) => {
      const getUrl = () => typeof url === 'function' ? url() : url
      const isFulfillment = getUrl().endsWith('/fulfillment')
      const data = isFulfillment ? fulfillmentData : menuData
      const clear = () => { data.value = null }
      const refresh = async () => {
        if (!isFulfillment) return
        const query = toValue(options.query ?? {})
        requests.push({ url: getUrl(), token: query.t })
        fulfillmentData.value = {
          modes: menu.modes,
          deliveryZones: [],
          table: null,
          tableError: query.t === undefined ? null : 'INVALID_TABLE',
        }
      }
      return { data, error: shallowRef(null), refresh, clear }
    })

    await renderSuspended(PublicMenuPage)
    expect(screen.getByText('Bàn A', { exact: true })).toBeTruthy()

    const currentRoute = mocks.route.value!
    currentRoute.params.slug = 'store-b'
    delete currentRoute.query.t
    await nextTick()
    await flushPromises()
    expect(screen.queryByText('Bàn A', { exact: true })).toBeNull()
    // PR3 also needs fulfillment without a table token to load the store's delivery zones.
    expect(requests).toEqual([{ url: '/api/public/stores/store-b/fulfillment', token: undefined }])
    expect(screen.queryByText(/Mã QR không hợp lệ/)).toBeNull()

    currentRoute.query.t = 'token-a'
    await nextTick()
    await flushPromises()
    expect(requests).toEqual([
      { url: '/api/public/stores/store-b/fulfillment', token: undefined },
      { url: '/api/public/stores/store-b/fulfillment', token: 'token-a' },
    ])
    expect(screen.getByText(/Mã QR không hợp lệ/)).toBeTruthy()
  })
})
