import { renderSuspended } from '@nuxt/test-utils/runtime'
import { cleanup, fireEvent, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZSheet from '~/components/z/Sheet.vue'
import ZTabs from '~/components/z/Tabs.vue'

afterEach(() => cleanup())

const items = [
  { label: 'Cửa hàng', value: 'store' },
  { label: 'Nhận món & khu vực giao', value: 'fulfillment' },
  { label: 'Bàn & QR', value: 'tables' },
]

describe('ZTabs', () => {
  it('renders every item and marks the selected one', async () => {
    await renderSuspended(ZTabs, { props: { modelValue: 'fulfillment', items } })
    expect(screen.getAllByRole('tab').map(tab => tab.textContent?.trim())).toEqual(items.map(item => item.label))
    expect(screen.getByRole('tab', { name: 'Nhận món & khu vực giao' }).getAttribute('aria-selected')).toBe('true')
  })

  it('emits the new value when another tab is activated', async () => {
    const { emitted } = await renderSuspended(ZTabs, { props: { modelValue: 'store', items } })
    await fireEvent.mouseDown(screen.getByRole('tab', { name: 'Bàn & QR' }), { button: 0 })
    expect(emitted()['update:modelValue']).toEqual([['tables']])
  })
})

describe('ZSheet', () => {
  it('shows title, description, body and footer when open', async () => {
    await renderSuspended(ZSheet, {
      props: { open: true, title: 'Sửa món', description: 'Chỉnh thông tin món' },
      slots: { default: () => h('p', 'Nội dung sheet'), footer: () => h('button', 'Lưu món') },
    })
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Sửa món')).toBeTruthy()
    expect(screen.getByText('Chỉnh thông tin món')).toBeTruthy()
    expect(screen.getByText('Nội dung sheet')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lưu món' })).toBeTruthy()
  })

  it('renders nothing while closed', async () => {
    await renderSuspended(ZSheet, { props: { open: false, title: 'Sửa món' }, slots: { default: () => h('p', 'Nội dung sheet') } })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('Nội dung sheet')).toBeNull()
  })
})
