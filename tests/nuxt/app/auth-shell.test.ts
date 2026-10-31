import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import AppAuthShell from '~/components/app/AuthShell.vue'

describe('AppAuthShell', () => {
  it('renders one h1, the step indicator, form slot and footer', async () => {
    await renderSuspended(AppAuthShell, {
      props: { title: 'Tạo cửa hàng đầu tiên', step: { current: 2, total: 2, label: 'Tạo cửa hàng' } },
      slots: { default: () => h('form', { 'aria-label': 'Biểu mẫu' }), footer: () => h('p', 'Chân trang') },
    })
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Tạo cửa hàng đầu tiên' })).toBeTruthy()
    expect(screen.getByText('Bước 2/2 · Tạo cửa hàng')).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Biểu mẫu' })).toBeTruthy()
    expect(screen.getByText('Chân trang')).toBeTruthy()
    expect(screen.getByRole('main')).toBeTruthy()
  })
})
