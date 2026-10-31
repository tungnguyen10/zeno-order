import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

// happy-dom has no window.confirm.
beforeEach(() => {
  Object.defineProperty(window, 'confirm', { value: () => true, configurable: true, writable: true })
})

describe('useUnsavedChangesGuard', () => {
  it('blocks unload only while dirty and detaches on unmount', async () => {
    const dirty = ref(false)
    const Host = defineComponent({
      setup() {
        useUnsavedChangesGuard(dirty)
        return () => h('div')
      },
    })
    const wrapper = await mountSuspended(Host)

    expect(fireBeforeUnload().defaultPrevented).toBe(false)
    dirty.value = true
    expect(fireBeforeUnload().defaultPrevented).toBe(true)

    wrapper.unmount()
    expect(fireBeforeUnload().defaultPrevented).toBe(false)
  })
})

describe('confirmDiscardUnsavedChanges', () => {
  it('asks only while a mounted guard is dirty and returns the answer', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const dirty = ref(false)
    const Host = defineComponent({
      setup() {
        useUnsavedChangesGuard(dirty)
        return () => h('div')
      },
    })
    const wrapper = await mountSuspended(Host)

    expect(confirmDiscardUnsavedChanges()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()

    dirty.value = true
    await nextTick()
    expect(confirmDiscardUnsavedChanges()).toBe(false)
    confirm.mockReturnValue(true)
    expect(confirmDiscardUnsavedChanges()).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)
    // Once discarded, follow-up navigation must not ask again.
    expect(confirmDiscardUnsavedChanges()).toBe(true)
    expect(confirm).toHaveBeenCalledTimes(2)

    wrapper.unmount()
    confirm.mockClear()
    expect(confirmDiscardUnsavedChanges()).toBe(true)
    expect(confirm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})
