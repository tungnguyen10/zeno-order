import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import TeamPanel from '~/components/team/TeamPanel.vue'
import ReportsPanel from '~/components/reports/ReportsPanel.vue'
import InvitationPanel from '~/components/team/InvitationPanel.vue'

const mocks = vi.hoisted(() => ({ api: vi.fn(), load: vi.fn(), setActiveStore: vi.fn(), navigate: vi.fn(), signOut: vi.fn() }))
const activeStore = ref({ id: 's1', role: 'OWNER' })
mockNuxtImport('useApi', () => () => mocks.api)
mockNuxtImport('useActiveStore', () => () => ({ activeStore, setActiveStore: mocks.setActiveStore }))
mockNuxtImport('useMe', () => () => ({ load: mocks.load }))
mockNuxtImport('useAuth', () => () => ({ user: ref({ email: 'staff@example.com' }), signOut: mocks.signOut }))
mockNuxtImport('useRoute', () => () => ({ params: { token: 'invite-token' }, fullPath: '/invite/invite-token' }))
mockNuxtImport('navigateTo', () => mocks.navigate)
const summary = { date: '2026-11-02', totalOrders: 3, completedCount: 1, cancelledCount: 1, grossVnd: 50000, collectedVnd: 20000, outstandingVnd: 30000, refundDueVnd: 0, collected: { CASH: 20000, SEPAY: 0, BANK_MANUAL: 0 } }
const report = { range: '7d', fromDate: '2026-10-27', toDate: '2026-11-02', orderCount: 3, cancelledCount: 1, grossVnd: 50000, collectedVnd: 20000, averageOrderVnd: 25000, topProducts: [{ name: 'Trà đào', qty: 2, revenueVnd: 50000 }], daily: [] }
const member = { userId: 'u1', email: 'staff@example.com', displayName: 'Nhân viên A', role: 'STAFF', status: 'ACTIVE', source: 'STORE', isSelf: false, canDisable: true }
beforeEach(() => {
  cleanup()
  clearNuxtData()
  activeStore.value = { id: 's1', role: 'OWNER' }
  vi.clearAllMocks()
  mocks.api.mockImplementation(async (url: string) => {
    if (url.endsWith('/summary')) return summary
    if (url.endsWith('/reports')) return report
    if (url.endsWith('/team')) return { members: [member], invitations: [] }
    if (url.startsWith('/api/invitations/')) return { storeName: 'Quán A', emailHint: 's***@example.com', emailMatches: true, emailVerified: true }
    return {}
  })
})

describe('owner operations pages', { timeout: 30_000 }, () => {
  it('shows staff the daily summary without requesting owner reports or team data', async () => {
    activeStore.value = { id: 's1', role: 'STAFF' }
    await renderSuspended(ReportsPanel)
    expect(screen.getByRole('heading', { name: /Hôm nay/ })).toBeTruthy()
    expect(screen.queryByText('Xu hướng')).toBeNull()
    await renderSuspended(TeamPanel)
    expect(screen.getByText('Chỉ chủ cửa hàng mới quản lý được nhân viên.')).toBeTruthy()
    expect(mocks.api).not.toHaveBeenCalledWith('/api/stores/s1/reports', expect.anything())
    expect(mocks.api).not.toHaveBeenCalledWith('/api/stores/s1/team')
  })

  it('creates a one-time invitation link and lets the owner hide it', async () => {
    mocks.api.mockImplementation(async (_url: string, options?: { method?: string }) => options?.method === 'POST'
      ? { invitation: { email: 'new@example.com' }, inviteUrl: 'https://zeno.example/invite/secret' }
      : { members: [member], invitations: [] })
    await renderSuspended(TeamPanel)
    await fireEvent.update(screen.getByLabelText('Email nhân viên'), 'new@example.com')
    await fireEvent.click(screen.getByRole('button', { name: 'Tạo lời mời' }))
    expect(await screen.findByTestId('invite-result')).toBeTruthy()
    expect(mocks.api).toHaveBeenCalledWith('/api/stores/s1/team/invitations', { method: 'POST', body: { email: 'new@example.com' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Xong, ẩn link' }))
    expect(screen.queryByTestId('invite-result')).toBeNull()
  })

  it('locks a staff member and reloads the member list', async () => {
    await renderSuspended(TeamPanel)
    await fireEvent.click(screen.getByRole('button', { name: 'Khóa' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/stores/s1/team/u1', { method: 'PATCH', body: { status: 'DISABLED' } }))
  })

  it('changes the report range and shows top products', async () => {
    await renderSuspended(ReportsPanel)
    expect(screen.getByText('Trà đào')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: '30 ngày' }))
    await waitFor(() => expect(mocks.api).toHaveBeenCalledWith('/api/stores/s1/reports', { query: { range: '30d' } }))
  })

  it('refreshes membership and selects the invited store before entering orders', async () => {
    mocks.api.mockImplementation(async (url: string) => url.endsWith('/accept') ? { store: { id: 'invited-store' } } : { storeName: 'Quán A', emailHint: 's***@example.com', emailMatches: true, emailVerified: true })
    await renderSuspended(InvitationPanel)
    await fireEvent.click(screen.getByRole('button', { name: 'Tham gia quán' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/app/orders'))
    expect(mocks.load).toHaveBeenCalledWith(true)
    expect(mocks.setActiveStore).toHaveBeenCalledWith('invited-store')
  })

  it('blocks accepting an invitation with a different email and preserves its redirect on logout', async () => {
    mocks.api.mockResolvedValue({ storeName: 'Quán A', emailHint: 's***@example.com', emailMatches: false, emailVerified: true })
    await renderSuspended(InvitationPanel)
    expect(screen.getByRole('button', { name: 'Tham gia quán' }).hasAttribute('disabled')).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất để dùng email khác' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ path: '/login', query: { redirect: '/invite/invite-token' } }))
  })
})
