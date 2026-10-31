import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'
import ZButton from '~/components/z/Button.vue'

function renderButton(props: Record<string, unknown> = {}, label = 'Lưu') {
  return renderSuspended(ZButton, { props, slots: { default: () => h('span', label) } })
}

describe('ZButton', () => {
  it('renders a primary, 44px, type=button button by default', async () => {
    await renderButton()
    const button = screen.getByRole('button', { name: 'Lưu' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.className).toContain('bg-primary')
    expect(button.className).toContain('min-h-11')
  })

  it('marks itself busy and disabled while loading', async () => {
    await renderButton({ loading: true })
    const button = screen.getByRole('button', { name: /Lưu/ })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it.each([
    ['sm', 'min-h-9'],
    ['lg', 'min-h-[50px]'],
  ])('size %s uses %s', async (size, cls) => {
    await renderButton({ size })
    expect(screen.getByRole('button').className).toContain(cls)
  })

  it('uses the error color for destructive', async () => {
    await renderButton({ variant: 'destructive' }, 'Xoá')
    expect(screen.getByRole('button', { name: 'Xoá' }).className).toContain('bg-error')
  })

  it('renders a link when given `to`', async () => {
    await renderButton({ to: '/signup' }, 'Đăng ký')
    expect(screen.getByRole('link', { name: 'Đăng ký' }).getAttribute('href')).toBe('/signup')
  })
})
