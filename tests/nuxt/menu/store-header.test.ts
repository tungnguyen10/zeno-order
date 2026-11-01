import { renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MenuStoreHeader from '~/components/menu/StoreHeader.vue'

const modes = { dineIn: true, pickup: true, delivery: { enabled: true, available: true } }

describe('MenuStoreHeader', () => {
  it('shows the store name as the only h1 and the accepting badge', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Trà Sữa Mây', isAcceptingOrders: true, modes } })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Trà Sữa Mây')
    expect(screen.getByText('Đang nhận đơn')).toBeTruthy()
  })

  it('shows the paused badge when the store is closed', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Quán', isAcceptingOrders: false, modes } })
    expect(screen.getByText('Tạm nghỉ')).toBeTruthy()
    expect(screen.queryByText('Đang nhận đơn')).toBeNull()
  })

  it('lists pickup and (only when available) delivery', async () => {
    await renderSuspended(MenuStoreHeader, {
      props: { name: 'Quán', isAcceptingOrders: true, modes: { ...modes, delivery: { enabled: true, available: false } } },
    })
    expect(screen.getByText('Mang đi')).toBeTruthy()
    expect(screen.queryByText('Giao hàng')).toBeNull()
  })

  it('shows the table label instead of a dine-in chip when a valid table is given', async () => {
    await renderSuspended(MenuStoreHeader, { props: { name: 'Quán', isAcceptingOrders: true, modes, tableLabel: 'Bàn 05' } })
    expect(screen.getByText('Bàn 05')).toBeTruthy()
  })
})
