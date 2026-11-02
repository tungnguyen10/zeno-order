import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Detail from '~/components/app/OrderDetailSlideover.vue'
import type { OrderDetailResponse } from '#shared/types/orders'
const { api } = vi.hoisted(() => ({ api: vi.fn() }))
mockNuxtImport('useApi', () => () => api)
function detail(id: string): OrderDetailResponse {
  return { order: { id, publicCode: id, status: 'NEW', fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID', latePayment: false, tableName: null, customerName: null, customerPhone: '0912345678', address: null, notes: null, totalVnd: 10000, createdAt: new Date().toISOString(), items: [] }, events: [], payment: null }
}
beforeEach(() => api.mockReset())
describe('order details', () => {
  it('ignores a slow previous order response after opening a different order', async () => {
    let resolve!: (value: OrderDetailResponse) => void
    api.mockReturnValueOnce(new Promise<OrderDetailResponse>((yes) => { resolve = yes })).mockResolvedValueOnce(detail('second'))
    const wrapper = await mountSuspended(Detail, { props: { storeId: 's1', orderId: 'first', role: 'OWNER' } })
    await wrapper.setProps({ orderId: 'second' })
    await flushPromises()
    resolve(detail('first'))
    await flushPromises()
    expect(document.body.textContent).toContain('Đơn second')
    expect(document.body.textContent).not.toContain('Đơn first')
    wrapper.unmount()
  })
})
