import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, isTerminalStatus, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '#shared/enums'

describe('shared enums', () => {
  it('lists the values defined by the spec, in state-machine order', () => {
    expect(FULFILLMENT_TYPES).toEqual(['DINE_IN', 'PICKUP', 'DELIVERY'])
    expect(ORDER_STATUSES).toEqual(['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'])
    expect(PAYMENT_METHODS).toEqual(['BANK_QR', 'PAY_ON_RECEIPT'])
    expect(PAYMENT_STATUSES).toEqual(['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'])
  })

  it('treats only COMPLETED and CANCELLED as terminal', () => {
    expect(ORDER_STATUSES.filter(isTerminalStatus)).toEqual(['COMPLETED', 'CANCELLED'])
  })
})
