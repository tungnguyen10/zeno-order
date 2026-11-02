import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useVisiblePolling } from '~/composables/useVisiblePolling'

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

async function mountPolling(task: () => Promise<void> | void, enabled?: () => boolean) {
  return mountSuspended(defineComponent({
    setup() {
      useVisiblePolling(task, { intervalMs: 4000, enabled })
      return () => h('div')
    },
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useVisiblePolling', () => {
  it('runs once on mount and then every interval while the tab is visible', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task)
    expect(task).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(8000)
    expect(task).toHaveBeenCalledTimes(4)
  })

  it('pauses in a hidden tab and refreshes immediately when it becomes visible again', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task)
    setVisibility('hidden')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(task).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(3)
  })

  it('never overlaps a slow request with the next tick', async () => {
    let release!: () => void
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    await mountPolling(task)
    await vi.advanceTimersByTimeAsync(12_000)
    expect(task).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(2)
  })

  it('stops for good once enabled() turns false', async () => {
    let on = true
    const task = vi.fn().mockResolvedValue(undefined)
    await mountPolling(task, () => on)
    on = false
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('stops when the component unmounts', async () => {
    const task = vi.fn().mockResolvedValue(undefined)
    const wrapper = await mountPolling(task)
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
  })
})


describe('polling lifecycle safety', () => {
  it('does not run initially or on visibility changes when disabled', async () => {
    const task = vi.fn()
    const wrapper = await mountPolling(task, () => false)
    setVisibility('hidden')
    setVisibility('visible')
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not run on mount while hidden', async () => {
    setVisibility('hidden')
    const task = vi.fn()
    const wrapper = await mountPolling(task)
    expect(task).not.toHaveBeenCalled()
    setVisibility('visible')
    expect(task).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('does not restart after unmounting during the first request', async () => {
    let release!: () => void
    const task = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const wrapper = await mountPolling(task)
    wrapper.unmount()
    release()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('continues polling after a failed refresh without an unhandled rejection', async () => {
    const task = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const wrapper = await mountPolling(task)
    await vi.advanceTimersByTimeAsync(4000)
    expect(task).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
