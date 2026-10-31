import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import AppStoreSwitcher from '~/components/app/StoreSwitcher.vue'
import ZSelect from '~/components/z/Select.vue'

const store = (id: string, name: string) => ({ id, orgId: 'o1', name, slug: id, role: 'OWNER' as const, isAcceptingOrders: true })

// happy-dom has no window.confirm.
beforeEach(() => {
  Object.defineProperty(window, 'confirm', { value: () => true, configurable: true, writable: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  useState('unsaved-changes').value = false
})

describe('AppStoreSwitcher', () => {
  it('keeps the current store when the user refuses to discard unsaved changes', async () => {
    useState('me').value = { user: { id: 'u', email: 'a@b.vn', displayName: 'A' }, organizations: [], stores: [store('a', 'Quán A'), store('b', 'Quán B')] }
    useCookie('zeno_active_store').value = 'a'
    useState('unsaved-changes').value = true
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const wrapper = await mountSuspended(AppStoreSwitcher)
    wrapper.findComponent(ZSelect).vm.$emit('update:modelValue', 'b')
    await nextTick()

    expect(window.confirm).toHaveBeenCalled()
    expect(useActiveStore().activeStore.value?.id).toBe('a')
  })

  it('switches immediately when nothing is unsaved', async () => {
    useState('me').value = { user: { id: 'u', email: 'a@b.vn', displayName: 'A' }, organizations: [], stores: [store('a', 'Quán A'), store('b', 'Quán B')] }
    useCookie('zeno_active_store').value = 'a'
    const confirm = vi.spyOn(window, 'confirm')

    const wrapper = await mountSuspended(AppStoreSwitcher)
    wrapper.findComponent(ZSelect).vm.$emit('update:modelValue', 'b')
    await nextTick()

    expect(confirm).not.toHaveBeenCalled()
    expect(useActiveStore().activeStore.value?.id).toBe('b')
  })
})
