import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsFulfillmentTab from '~/components/settings/FulfillmentTab.vue'
import type { StoreDetail } from '#shared/types/identity'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const store = (overrides: Partial<StoreDetail> = {}): StoreDetail => ({
  id: 's1', orgId: 'o1', name: 'Quán', slug: 'quan', role: 'OWNER', isAcceptingOrders: true,
  dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false, ...overrides,
})
const zone = (overrides = {}) => ({ id: 'z1', name: 'Quận 1', feeVnd: 15000, active: true, position: 0, ...overrides })

beforeEach(() => {
  api.mockReset()
  api.mockImplementation(async (url: string) => (url.endsWith('/delivery-zones') ? { zones: [] } : {}))
})

describe('SettingsFulfillmentTab', () => {
  it('saves a toggled mode immediately and tells the parent', async () => {
    const { emitted } = await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.click(screen.getByRole('switch', { name: 'Giao hàng' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/fulfillment', { method: 'PATCH', body: { deliveryEnabled: true } }))
    await waitFor(() => expect(emitted().changed).toHaveLength(1))
  })

  it('reverts a switch when the server refuses', async () => {
    api.mockImplementation(async (url: string) => {
      if (url.endsWith('/delivery-zones')) return { zones: [] }
      throw { data: { code: 'VALIDATION_FAILED', message: 'Cần bật ít nhất một hình thức nhận món' } }
    })
    const { emitted } = await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ pickupEnabled: false }) } })
    await fireEvent.click(screen.getByRole('switch', { name: 'Tại bàn' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Tại bàn' }).getAttribute('aria-checked')).toBe('true'))
    expect(emitted().changed).toBeUndefined()
  })

  it('warns when delivery is on without an active zone', async () => {
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ deliveryEnabled: true }) } })
    expect(await screen.findByText(/Chưa có khu vực giao đang bật/)).toBeTruthy()
  })

  it('does not warn once an active zone exists', async () => {
    api.mockImplementation(async (url: string) => (url.endsWith('/delivery-zones') ? { zones: [zone()] } : {}))
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store({ deliveryEnabled: true }) } })
    expect(await screen.findByDisplayValue('Quận 1')).toBeTruthy()
    expect(screen.queryByText(/Chưa có khu vực giao đang bật/)).toBeNull()
  })

  it('adds a zone from a short fee like 15k', async () => {
    api.mockImplementation(async (url: string, options?: { method?: string }) => options?.method === 'POST' ? zone() : url.endsWith('/delivery-zones') ? { zones: [] } : {})
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.update(screen.getByLabelText('Tên khu vực'), 'Quận 1')
    await fireEvent.update(screen.getByLabelText('Phí giao (đ)'), '15k')
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm khu vực' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1/delivery-zones', { method: 'POST', body: { name: 'Quận 1', feeVnd: 15000 } }))
    expect(await screen.findByDisplayValue('Quận 1')).toBeTruthy()
  })

  it('rejects an invalid fee without posting', async () => {
    await renderSuspended(SettingsFulfillmentTab, { props: { store: store() } })
    await fireEvent.update(screen.getByLabelText('Tên khu vực'), 'Quận 1')
    await fireEvent.update(screen.getByLabelText('Phí giao (đ)'), 'abc')
    await fireEvent.click(screen.getByRole('button', { name: 'Thêm khu vực' }))
    expect(await screen.findByText(/Nhập phí giao hợp lệ/)).toBeTruthy()
    expect(api).not.toHaveBeenCalledWith('/api/stores/s1/delivery-zones', expect.objectContaining({ method: 'POST' }))
  })
})
