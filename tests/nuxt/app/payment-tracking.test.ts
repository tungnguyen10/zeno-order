import { mockNuxtImport, registerEndpoint, renderSuspended } from '@nuxt/test-utils/runtime'
import { screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import type { PaymentStatus } from '#shared/enums'
import type { PublicOrderView } from '#shared/types/order'
import OrderTracking from '~/pages/o/[token].vue'
const { polling } = vi.hoisted(() => ({ polling: { refresh: null as (() => Promise<void>) | null } }))
mockNuxtImport('useVisiblePolling', () => (refresh: () => Promise<void>) => { polling.refresh = refresh })
mockNuxtImport('useRoute', () => () => ({ params: { token: 'test-token' } }))
let currentOrder: PublicOrderView
registerEndpoint('/api/public/orders/test-token', () => currentOrder)
function order(paymentStatus: PaymentStatus): PublicOrderView {
  return { publicCode: 'ABC123', status: 'AWAITING_PAYMENT', paymentStatus, paymentMethod: 'BANK_QR', fulfillmentType: 'PICKUP', tableLabel: null, deliveryZoneName: null, customerName: null, phoneMasked: null, items: [], subtotalVnd: 20000, deliveryFeeVnd: 0, totalVnd: 20000, createdAt: '2026-11-01T00:00:00Z', store: { name: 'Coffee', slug: 'coffee' }, qr: null }
}
describe('tracking payment status', () => {
  it.each(['REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'] as const)('does not offer another payment for %s', async (status) => {
    await renderSuspended(OrderTracking)
    currentOrder = order(status)
    await polling.refresh?.()
    expect(screen.queryByRole('button', { name: 'Tạo mã mới' })).toBeNull()
    expect(screen.getByText(/đừng chuyển lại/)).toBeTruthy()
  })
  it('shows payment received without a renewal button', async () => {
    await renderSuspended(OrderTracking)
    currentOrder = order('PAID')
    await polling.refresh?.()
    expect(screen.getAllByText('Đã thanh toán').length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Tạo mã mới' })).toBeNull()
  })
})
