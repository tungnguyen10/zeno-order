import { mockNuxtImport, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen, waitFor } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsHoursTab from '~/components/settings/HoursTab.vue'
import type { OpeningHours } from '#shared/store-hours'
import type { StoreDetail } from '#shared/types/identity'

const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)

const store = (overrides: Partial<StoreDetail> = {}): StoreDetail => ({
  id: 's1', orgId: 'o1', name: 'Quán', slug: 'quan', role: 'OWNER', isAcceptingOrders: true,
  dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false, openingHours: null, pausedUntil: null, ...overrides,
})

beforeEach(() => {
  api.mockReset()
  api.mockResolvedValue({})
})

describe('SettingsHoursTab', () => {
  it('pauses for 30 minutes with a near-future ISO timestamp', async () => {
    const { emitted } = await renderSuspended(SettingsHoursTab, { props: { store: store() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Đóng 30 phút' }))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const [url, options] = api.mock.calls[0]!
    expect(url).toBe('/api/stores/s1')
    const until = Date.parse((options as { body: { pausedUntil: string } }).body.pausedUntil)
    const minutesAhead = (until - Date.now()) / 60_000
    expect(minutesAhead).toBeGreaterThan(29)
    expect(minutesAhead).toBeLessThan(31)
    await waitFor(() => expect(emitted().changed).toHaveLength(1))
  })

  it('resumes by sending a null pause when already paused', async () => {
    await renderSuspended(SettingsHoursTab, { props: { store: store({ pausedUntil: new Date(Date.now() + 3_600_000).toISOString() }) } })
    expect(screen.getByText(/Đang tạm đóng đến/)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Mở lại ngay' }))
    await waitFor(() => expect(api).toHaveBeenCalledWith('/api/stores/s1', { method: 'PATCH', body: { pausedUntil: null } }))
  })

  it('saves the weekly schedule as a 7-day opening-hours object', async () => {
    const hours: OpeningHours = { enabled: true, days: Array.from({ length: 7 }, () => ({ open: '07:00', close: '22:00' })) }
    await renderSuspended(SettingsHoursTab, { props: { store: store({ openingHours: hours }) } })
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ hoạt động' }))
    await waitFor(() => expect(api).toHaveBeenCalledTimes(1))
    const body = (api.mock.calls[0]![1] as { body: { openingHours: OpeningHours } }).body
    expect(body.openingHours.enabled).toBe(true)
    expect(body.openingHours.days).toHaveLength(7)
    expect(body.openingHours.days.every(day => day?.open === '07:00')).toBe(true)
  })

  it('refuses to save when a day closes before it opens', async () => {
    const hours: OpeningHours = { enabled: true, days: Array.from({ length: 7 }, () => ({ open: '22:00', close: '07:00' })) }
    await renderSuspended(SettingsHoursTab, { props: { store: store({ openingHours: hours }) } })
    await fireEvent.click(screen.getByRole('button', { name: 'Lưu giờ hoạt động' }))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(api).not.toHaveBeenCalled()
  })
})
