import { mockNuxtImport, registerEndpoint, renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readBody, setResponseStatus } from 'h3'
import { ref } from 'vue'
import CheckoutSheet from '~/components/order/CheckoutSheet.vue'

const { cart, fetchOrder } = vi.hoisted(() => ({ cart: { value: null as unknown }, fetchOrder: vi.fn() }))
registerEndpoint('/api/public/stores/coffee/orders', { method: 'POST', handler: async (event) => { fetchOrder(await readBody(event)); setResponseStatus(event, 409); return { code: 'PAYMENT_METHOD_UNAVAILABLE', message: 'Unavailable' } } })
mockNuxtImport('useCart', () => () => cart.value)
mockNuxtImport('useRecentOrders', () => () => ({ add: vi.fn() }))
const global = { stubs: { ZSheet: { template: '<div><slot /><slot name="footer" /></div>' } } }
const props = { open: true, slug: 'coffee', storeName: 'Coffee', acceptingOrders: true, dineInEnabled: true, pickupEnabled: true, deliveryEnabled: false, deliveryZones: [], tableToken: 'table-token', tableLabel: 'Bàn 1' }
beforeEach(() => {
  fetchOrder.mockReset()
  cart.value = { ready: ref(true), lines: ref([{ lineId: 'line', productId: 'bb035d85-268e-444f-8997-cf0b45ccfacc', optionValueIds: [], name: 'Coffee', optionLabels: [], unitPriceVnd: 20000, quantity: 1, note: '' }]), subtotalVnd: ref(20000), hasStale: ref(false), customer: ref({ name: '', phone: '', address: '' }), note: ref(''), deliveryZoneId: ref(null), fulfillmentType: ref('PICKUP'), updateForm: vi.fn(), ensureIdempotencyKey: () => '5a96d200-999f-49d4-bb34-d6867f307b3e', clearAfterSuccess: vi.fn() }
})
describe('checkout payment selection', () => {
  it('shows VietQR only when the store is ready', async () => {
    const view = await renderSuspended(CheckoutSheet, { props, global })
    expect(screen.queryByRole('radio', { name: 'Chuyển khoản (VietQR)' })).toBeNull()
    await view.rerender({ bankQrEnabled: true })
    expect(screen.getByRole('radio', { name: 'Chuyển khoản (VietQR)' })).toBeTruthy()
  })
  it('does not offer QR for a zero total', async () => {
    (cart.value as { subtotalVnd: { value: number } }).subtotalVnd.value = 0
    await renderSuspended(CheckoutSheet, { props: { ...props, bankQrEnabled: true }, global })
    expect(screen.queryByRole('radio', { name: 'Chuyển khoản (VietQR)' })).toBeNull()
  })
  it('sends BANK_QR and refreshes unavailable methods while keeping the cart', async () => {
    const view = await renderSuspended(CheckoutSheet, { props: { ...props, bankQrEnabled: true }, global })
    await fireEvent.click(screen.getByRole('radio', { name: 'Chuyển khoản (VietQR)' }))
    await fireEvent.update(screen.getByLabelText('Tên của bạn'), 'Khách')
    await fireEvent.update(screen.getByLabelText('Số điện thoại'), '0912345678')
    await fireEvent.click(screen.getByRole('button', { name: /Đặt món/ }))
    await vi.waitFor(() => expect(fetchOrder).toHaveBeenCalled(), { timeout: 3000 })
    expect(fetchOrder.mock.calls[0]?.[0].paymentMethod).toBe('BANK_QR')
    expect(await screen.findByText('Chuyển khoản đang tạm ngưng')).toBeTruthy()
    expect(view.emitted().refresh).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Trả tiền khi nhận món' }).getAttribute('aria-checked')).toBe('true')
  })
})
