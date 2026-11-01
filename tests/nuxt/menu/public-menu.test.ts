import type { PublicMenu } from '#shared/types/catalog'
import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import PublicMenuPage from '~/pages/s/[slug].vue'

const { fetchMenu } = vi.hoisted(() => ({ fetchMenu: vi.fn() }))
mockNuxtImport('useFetch', () => fetchMenu)

describe('public menu loading error', () => {
  it('shows a recoverable error and retries the menu request', async () => {
    const menu = shallowRef<PublicMenu | null>(null)
    const error = shallowRef<{ statusCode: number } | null>({ statusCode: 503 })
    const refresh = vi.fn(async () => {
      error.value = null
      menu.value = {
        store: { name: 'Quán hồi phục', slug: 'retry', isAcceptingOrders: true, logoUrl: null },
        modes: { dineIn: false, pickup: true, delivery: { enabled: false, available: false } },
        categories: [],
        products: [],
      }
    })
    fetchMenu.mockResolvedValue({ data: menu, error, refresh })

    await renderSuspended(PublicMenuPage)
    expect(screen.getByRole('alert').textContent).toContain('Không tải được menu')
    await fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.queryByText('Không tải được menu')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Quán hồi phục')
  })
})
