import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useOrderAlerts } from '~/composables/useOrderAlerts'
const { add } = vi.hoisted(() => ({ add: vi.fn() }))
mockNuxtImport('useToast', () => () => ({ add }))

describe('order alerts baseline', () => {
  it('does not announce existing orders after switching stores, then announces later arrivals', async () => {
    const ids = ref<string[]>(['a'])
    const store = ref<string | null>('s1')
    const ready = ref(true)
    const wrapper = await mountSuspended(defineComponent({
      setup() { useOrderAlerts(ids, store, ready); return () => h('div') },
    }))
    ids.value = ['a']
    await nextTick()
    add.mockClear()
    store.value = 's2'
    ready.value = false
    ids.value = []
    await nextTick()
    ids.value = ['b', 'c']
    ready.value = true
    await nextTick()
    expect(add).not.toHaveBeenCalled()
    ids.value = ['b', 'c', 'd']
    await nextTick()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ title: 'Có 1 đơn mới' }))
    wrapper.unmount()
  })
})
