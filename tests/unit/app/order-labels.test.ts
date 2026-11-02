import { describe, expect, it } from 'vitest'
import { ORDER_STATUSES } from '#shared/enums'
import { customerPaymentLabel, customerStatusLabel, customerStatusTone, fulfillmentSummary, orderProgressSteps } from '../../../app/utils/order-labels'

describe('customerStatusLabel', () => {
  it.each([
    ['AWAITING_PAYMENT', 'PICKUP', 'Chờ thanh toán'],
    ['NEW', 'PICKUP', 'Đã gửi quán'],
    ['PREPARING', 'DINE_IN', 'Quán đang làm món'],
    ['READY', 'DINE_IN', 'Món đã xong'],
    ['READY', 'PICKUP', 'Sẵn sàng, mời bạn lấy món'],
    ['READY', 'DELIVERY', 'Món đã xong, chờ giao'],
    ['DELIVERING', 'DELIVERY', 'Đang giao đến bạn'],
    ['COMPLETED', 'PICKUP', 'Hoàn tất'],
    ['CANCELLED', 'DELIVERY', 'Quán đã hủy đơn'],
  ] as const)('%s (%s) → %s', (status, type, label) => {
    expect(customerStatusLabel(status, type)).toBe(label)
  })

  it('has a label and a tone for every status', () => {
    for (const status of ORDER_STATUSES) {
      expect(customerStatusLabel(status, 'PICKUP')).not.toBe('')
      expect(['success', 'warning', 'error', 'info', 'neutral']).toContain(customerStatusTone(status))
    }
  })
})

describe('orderProgressSteps', () => {
  it('skips DELIVERING for dine-in and pickup', () => {
    expect(orderProgressSteps('DINE_IN')).toEqual(['NEW', 'PREPARING', 'READY', 'COMPLETED'])
    expect(orderProgressSteps('PICKUP')).toEqual(['NEW', 'PREPARING', 'READY', 'COMPLETED'])
    expect(orderProgressSteps('DELIVERY')).toEqual(['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED'])
  })
})

describe('customerPaymentLabel', () => {
  it.each([
    ['PAY_ON_RECEIPT', 'UNPAID', 'Trả tiền khi nhận món'],
    ['PAY_ON_RECEIPT', 'PAID', 'Đã thanh toán'],
    ['BANK_QR', 'PENDING', 'Chờ chuyển khoản'],
    ['BANK_QR', 'PAID', 'Đã thanh toán'],
    ['BANK_QR', 'REVIEW_REQUIRED', 'Đang đối soát thanh toán'],
    ['BANK_QR', 'REFUND_DUE', 'Chờ hoàn tiền'],
    ['BANK_QR', 'REFUNDED', 'Đã hoàn tiền'],
  ] as const)('%s / %s → %s', (method, status, label) => {
    expect(customerPaymentLabel(method, status)).toBe(label)
  })
})

describe('fulfillmentSummary', () => {
  it('names the table, pickup or delivery zone', () => {
    expect(fulfillmentSummary({ fulfillmentType: 'DINE_IN', tableLabel: 'Bàn 05', deliveryZoneName: null })).toBe('Bàn 05')
    expect(fulfillmentSummary({ fulfillmentType: 'DINE_IN', tableLabel: null, deliveryZoneName: null })).toBe('Tại bàn')
    expect(fulfillmentSummary({ fulfillmentType: 'PICKUP', tableLabel: null, deliveryZoneName: null })).toBe('Mang đi')
    expect(fulfillmentSummary({ fulfillmentType: 'DELIVERY', tableLabel: null, deliveryZoneName: 'Quận 1' })).toBe('Giao hàng · Quận 1')
  })
})
