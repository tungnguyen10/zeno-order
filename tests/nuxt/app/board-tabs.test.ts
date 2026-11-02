import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppBoardTabs from '~/components/app/BoardTabs.vue'

const counts = { new: 3, doing: 0, ready: 1, other: 0, awaiting_payment: 0 }

describe('AppBoardTabs', () => {
  it('shows tabs with badges, hides an empty "Chờ thanh toán" tab and marks the selected one', async () => {
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts } })
    const selected = screen.getByRole('tab', { selected: true })
    expect(selected.textContent).toContain('Mới')
    expect(selected.textContent).toContain('3')
    expect(screen.getByRole('tab', { name: /Sẵn sàng/ }).textContent).toContain('1')
    expect(screen.queryByRole('tab', { name: /Chờ thanh toán/ })).toBeNull()
  })

  it('shows "Chờ thanh toán" when it has orders', async () => {
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts: { ...counts, awaiting_payment: 2 } } })
    expect(screen.getByRole('tab', { name: /Chờ thanh toán/ }).textContent).toContain('2')
  })

  it('emits the chosen tab and keeps tap targets at least 44px tall by class', async () => {
    const onUpdate = vi.fn()
    await renderSuspended(AppBoardTabs, { props: { modelValue: 'new', counts, 'onUpdate:modelValue': onUpdate } })
    const tab = screen.getByRole('tab', { name: /Đang làm/ })
    expect(tab.className).toContain('min-h-12')
    await fireEvent.click(tab)
    expect(onUpdate).toHaveBeenCalledWith('doing')
  })
})
