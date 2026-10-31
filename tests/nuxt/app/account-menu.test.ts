import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import AppAccountMenu from '~/components/app/AccountMenu.vue'

const { signOut, navigate } = vi.hoisted(() => ({
  signOut: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}))

mockNuxtImport('useAuth', () => () => ({ signOut }))
mockNuxtImport('navigateTo', () => navigate)

describe('AppAccountMenu', () => {
  it('shows the user and signs out to /login', async () => {
    useState('me', () => ({
      user: { id: 'u1', email: 'chu@quan.vn', displayName: 'Mây Trần' },
      organizations: [],
      stores: [],
    }))
    await renderSuspended(AppAccountMenu)

    expect(screen.getAllByText('Mây Trần').length).toBeGreaterThan(0)
    expect(screen.getAllByText('chu@quan.vn').length).toBeGreaterThan(0)
    const [signOutButton] = screen.getAllByRole('button', { name: 'Đăng xuất' })
    await fireEvent.click(signOutButton!)

    expect(signOut).toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/login')
  })

  it('still navigates to /login when signOut throws', async () => {
    signOut.mockRejectedValueOnce(new Error('network'))
    useState('me', () => ({ user: { id: 'u1', email: 'a@b.vn', displayName: null }, organizations: [], stores: [] }))
    await renderSuspended(AppAccountMenu)
    const [signOutButton] = screen.getAllByRole('button', { name: 'Đăng xuất' })
    await fireEvent.click(signOutButton!)
    expect(navigate).toHaveBeenLastCalledWith('/login')
  })
})
