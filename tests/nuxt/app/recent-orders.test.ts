import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { computed, defineComponent, h, ref, nextTick } from 'vue'
import { useRecentOrders } from '~/composables/useRecentOrders'

const entry = { token: 'token', publicCode: 'CODE', storeSlug: 'first', storeName: 'Store', totalVnd: 1000, createdAt: new Date().toISOString() }

async function mountRecent() {
  let recent!: ReturnType<typeof useRecentOrders>
  const wrapper = await mountSuspended(defineComponent({ setup() { recent = useRecentOrders(); return () => h('div') } }))
  return { recent, wrapper }
}

beforeEach(() => { localStorage.clear(); clearNuxtState() })
afterEach(() => vi.restoreAllMocks())

describe('recent order persistence', () => {
  it('restores links and follows a reactive store slug', async () => {
    localStorage.setItem('zeno:orders', JSON.stringify([entry]))
    const { recent, wrapper } = await mountRecent()
    const slug = ref('first')
    const orders = recent.forStore(computed(() => slug.value))
    expect(orders.value).toHaveLength(1)
    slug.value = 'second'
    await nextTick()
    expect(orders.value).toEqual([])
    wrapper.unmount()
  })

  it('retains a new link in memory when storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    const { recent, wrapper } = await mountRecent()
    expect(() => recent.add(entry)).not.toThrow()
    expect(recent.forStore('first').value).toEqual([entry])
    wrapper.unmount()
  })
})
