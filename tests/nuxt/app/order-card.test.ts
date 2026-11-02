import { renderSuspended } from '@nuxt/test-utils/runtime'
import { fireEvent, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import type { BoardOrder } from '#shared/types/orders'
import AppOrderCard from '~/components/app/OrderCard.vue'

const order = (over: Partial<BoardOrder> = {}): BoardOrder => ({
  id: 'o1', publicCode: 'K7M2PQ', status: 'NEW', fulfillmentType: 'PICKUP', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID',
  latePayment: false, tableName: null, customerName: 'Lan', customerPhone: '0901234567', address: null, notes: 'Ít đá',
  totalVnd: 50_000, createdAt: new Date().toISOString(),
  items: [{ id: 'i1', name: 'Trà đào', qty: 2, options: ['30% đường', 'Thêm đào'], unitPriceVnd: 25_000, lineTotalVnd: 50_000 }],
  ...over,
})

describe('AppOrderCard', () => {
  it('shows code, items with options, total and customer', async () => {
    await renderSuspended(AppOrderCard, { props: { order: order(), now: Date.now() } })
    expect(screen.getByText('K7M2PQ')).toBeTruthy()
    expect(screen.getByText(/Trà đào/)).toBeTruthy()
    expect(screen.getByText(/30% đường/)).toBeTruthy()
    expect(screen.getByText('50.000đ')).toBeTruthy()
    expect(screen.getByText(/Lan/)).toBeTruthy()
    expect(screen.getByText('Chưa thu')).toBeTruthy()
  })

  it('has one primary action and a cash button for unpaid COD; both emit', async () => {
    const { emitted } = await renderSuspended(AppOrderCard, { props: { order: order(), now: Date.now() } })
    await fireEvent.click(screen.getByRole('button', { name: 'Bắt đầu làm' }))
    await fireEvent.click(screen.getByRole('button', { name: /Đã thu tiền mặt/ }))
    expect(emitted().advance).toEqual([['PREPARING']])
    expect(emitted().markPaid).toHaveLength(1)
  })

  it.each([
    ['NEW', 'PICKUP', 'Bắt đầu làm'],
    ['PREPARING', 'DINE_IN', 'Đã xong'],
    ['READY', 'DELIVERY', 'Đi giao'],
    ['DELIVERING', 'DELIVERY', 'Đã giao xong'],
  ] as const)('%s / %s shows "%s"', async (status, fulfillmentType, label) => {
    await renderSuspended(AppOrderCard, { props: { order: order({ status, fulfillmentType, paymentStatus: 'PAID' }), now: Date.now() } })
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Đã thu tiền mặt/ })).toBeNull()
  })

  it('has no action buttons for AWAITING_PAYMENT (system-owned) or finished orders', async () => {
    await renderSuspended(AppOrderCard, {
      props: { order: order({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' }), now: Date.now() },
    })
    expect(screen.queryByRole('button', { name: 'Bắt đầu làm' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Đã thu tiền mặt/ })).toBeNull()
    expect(screen.getByText('Chờ chuyển khoản')).toBeTruthy()
  })

  it('disables the actions while busy and opens the detail from the info area', async () => {
    const { emitted } = await renderSuspended(AppOrderCard, { props: { order: order(), busy: true, now: Date.now() } })
    expect((screen.getByRole('button', { name: 'Bắt đầu làm' }) as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: /Xem chi tiết đơn K7M2PQ/ }))
    expect(emitted().open).toHaveLength(1)
  })

  it('shows the dine-in table name', async () => {
    await renderSuspended(AppOrderCard, { props: { order: order({ fulfillmentType: 'DINE_IN', tableName: 'Bàn 05' }), now: Date.now() } })
    expect(screen.getByText(/Bàn 05/)).toBeTruthy()
  })
})
