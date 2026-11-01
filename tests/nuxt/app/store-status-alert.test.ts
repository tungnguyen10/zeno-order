import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AppStoreStatusAlert from '~/components/app/StoreStatusAlert.vue'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

function meWith(isAcceptingOrders: boolean, role: 'OWNER' | 'STAFF' = 'OWNER') {
  return {
    user: { id: 'u1', email: 'a@b.vn', displayName: 'A' },
    organizations: [],
    stores: [{ id: 's1', orgId: 'o1', name: 'Quán A', slug: 'quan-a', role, isAcceptingOrders }],
  }
}

beforeEach(() => {
  api.mockReset()
  useCookie('zeno_active_store').value = 's1'
})

describe('AppStoreStatusAlert', () => {
  it('turns ordering on in one tap and refreshes /api/me without navigating', async () => {
    useState('me').value = meWith(false)
    api.mockImplementation(async (url: string) => (url === '/api/me' ? meWith(true) : { id: 's1' }))
    await renderSuspended(AppStoreStatusAlert)

    await fireEvent.click(screen.getByRole('button', { name: 'Bật nhận đơn' }))

    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1', { method: 'PATCH', body: { isAcceptingOrders: true } }))
    expect(api).toHaveBeenCalledWith('/api/me')
    await waitFor(() => expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull())
  })

  it('keeps the alert and re-enables the button when the request fails', async () => {
    useState('me').value = meWith(false)
    api.mockRejectedValue({ data: { code: 'INTERNAL', message: 'Lỗi máy chủ' } })
    await renderSuspended(AppStoreStatusAlert)

    const button = screen.getByRole('button', { name: 'Bật nhận đơn' })
    await fireEvent.click(button)

    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Bật nhận đơn' }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByText(/Quán đang tạm nghỉ/)).toBeTruthy()

    api.mockImplementation(async (url: string) => url === '/api/me' ? meWith(true) : { id: 's1' })
    await fireEvent.click(screen.getByRole('button', { name: 'Bật nhận đơn' }))
    await waitFor(() => expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull())
    expect(api).toHaveBeenCalledTimes(3)
  })

  it('ignores duplicate enable requests while the first request is pending', async () => {
    useState('me').value = meWith(false)
    let finishPatch!: () => void
    api.mockImplementation((url: string) => url === '/api/me'
      ? Promise.resolve(meWith(true))
      : new Promise<void>((resolve) => { finishPatch = resolve }))
    const { container } = await renderSuspended(AppStoreStatusAlert)
    const button = screen.getByRole('button', { name: 'Bật nhận đơn' })

    // Dispatch synchronously before Vue has rendered the loading/disabled state.
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(api).toHaveBeenCalledTimes(1)
    expect(container.querySelector('a')).toBeNull()
    finishPatch()
    await waitFor(() => expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull())
  })

  it('does not offer the button to staff', async () => {
    useState('me').value = meWith(false, 'STAFF')
    await renderSuspended(AppStoreStatusAlert)
    expect(screen.getByText(/Quán đang tạm nghỉ/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Bật nhận đơn' })).toBeNull()
  })

  it('renders nothing while the store accepts orders', async () => {
    useState('me').value = meWith(true)
    await renderSuspended(AppStoreStatusAlert)
    expect(screen.queryByText(/Quán đang tạm nghỉ/)).toBeNull()
  })
})
