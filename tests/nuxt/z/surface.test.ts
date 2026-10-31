import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZAlert from '~/components/z/Alert.vue'
import ZBadge from '~/components/z/Badge.vue'
import ZCard from '~/components/z/Card.vue'

describe('ZAlert', () => {
  it.each([
    ['error', 'alert'],
    ['warning', 'alert'],
    ['info', 'status'],
    ['success', 'status'],
  ] as const)('%s uses role=%s', async (color, role) => {
    await renderSuspended(ZAlert, { props: { color, title: 'Thông báo' } })
    expect(screen.getByRole(role).textContent).toContain('Thông báo')
  })

  it('renders an actions slot', async () => {
    await renderSuspended(ZAlert, {
      props: { color: 'warning', title: 'Tạm nghỉ' },
      slots: { actions: () => h('button', 'Bật nhận đơn') },
    })
    expect(screen.getByRole('button', { name: 'Bật nhận đơn' })).toBeTruthy()
  })
})

describe('ZBadge', () => {
  it.each([
    ['success', 'bg-emerald-100'],
    ['warning', 'bg-amber-100'],
    ['error', 'bg-red-100'],
    ['info', 'bg-indigo-100'],
  ] as const)('%s uses %s', async (status, cls) => {
    await renderSuspended(ZBadge, { props: { status }, slots: { default: () => 'Nhãn' } })
    expect(screen.getByText('Nhãn').closest('span[class*="rounded-full"]')!.className).toContain(cls)
  })
})

describe('ZCard', () => {
  it('renders title and body, raised by default', async () => {
    const { container } = await renderSuspended(ZCard, {
      props: { title: 'Nhận đơn' },
      slots: { default: () => h('p', 'Nội dung') },
    })
    expect(screen.getByRole('heading', { level: 2, name: 'Nhận đơn' })).toBeTruthy()
    expect(screen.getByText('Nội dung')).toBeTruthy()
    expect(container.querySelector('[data-slot="root"]')!.className).toContain('shadow-raised')
  })
})
