import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, ref } from 'vue'

function fireBeforeUnload(): Event {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event
}

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
