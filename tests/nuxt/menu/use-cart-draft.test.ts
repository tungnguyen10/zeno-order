import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { PublicProduct } from '#shared/types/catalog'

const productA: PublicProduct = { id: 'a-item', categoryId: null, name: 'Món A', description: null, basePriceVnd: 10000, isAvailable: true, imageUrl: null, optionGroups: [] }
const productB: PublicProduct = { id: 'b-item', categoryId: null, name: 'Món B', description: null, basePriceVnd: 20000, isAvailable: true, imageUrl: null, optionGroups: [] }

const CartHarness = defineComponent({
  setup() {
    const slug = ref('store-a')
    const cart = useCartDraft(slug)
    return { slug, cart }
  },
  template: '<div>{{ cart.totals.value.count }}|{{ cart.totals.value.totalVnd }}</div>',
})

describe('useCartDraft store scope', () => {
  it('switches draft lines with the reactive store slug and keeps each store separate', async () => {
    clearNuxtState('cart-draft-by-store')
    const wrapper = await mountSuspended(CartHarness)
    const cart = wrapper.vm.cart as ReturnType<typeof useCartDraft>

    cart.add(productA, [], 1)
    await nextTick()
    expect(wrapper.text()).toBe('1|10000')

    wrapper.vm.slug = 'store-b'
    await nextTick()
    expect(wrapper.text()).toBe('0|0')

    cart.add(productB, [], 1)
    await nextTick()
    expect(wrapper.text()).toBe('1|20000')

    wrapper.vm.slug = 'store-a'
    await nextTick()
    expect(wrapper.text()).toBe('1|10000')
    wrapper.unmount()
    clearNuxtState('cart-draft-by-store')
  })
})
