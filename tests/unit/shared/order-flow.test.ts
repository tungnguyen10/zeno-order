import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, type FulfillmentType, type OrderStatus } from '../../../shared/enums'
import {
  BOARD_TABS,
  TAB_STATUSES,
  advanceTargets,
  canCancelOrder,
  canMarkCashPaid,
  paymentStatusAfterCancel,
  primaryAction,
  tabForStatus,
  transitionLabel,
} from '../../../shared/order-flow'

const same = (targets: OrderStatus[]): Record<FulfillmentType, OrderStatus[]> => ({ DINE_IN: targets, PICKUP: targets, DELIVERY: targets })

// Bảng kỳ vọng viết tay theo spec §5.3: 7 trạng thái × 3 fulfillment = 21 ô.
const EXPECTED: Record<OrderStatus, Record<FulfillmentType, OrderStatus[]>> = {
  AWAITING_PAYMENT: same([]),
  NEW: same(['PREPARING', 'READY']),
  PREPARING: same(['READY']),
  READY: { DINE_IN: ['COMPLETED'], PICKUP: ['COMPLETED'], DELIVERY: ['DELIVERING'] },
  // Chỉ đơn DELIVERY tới được DELIVERING; ô DINE_IN/PICKUP không tới được nhưng khớp bảng PR3 (`DELIVERING → COMPLETED`).
  DELIVERING: same(['COMPLETED']),
  COMPLETED: same([]),
  CANCELLED: same([]),
}

describe('advanceTargets (exhaustive)', () => {
  it('covers every status', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...ORDER_STATUSES].sort())
  })

  it.each(ORDER_STATUSES.flatMap(status => FULFILLMENT_TYPES.map(fulfillmentType => [status, fulfillmentType] as const)))(
    '%s / %s',
    (status, fulfillmentType) => {
      expect(advanceTargets({ status, fulfillmentType })).toEqual(EXPECTED[status][fulfillmentType])
    },
  )

  it('never goes backwards, never cancels, never leaves a terminal state', () => {
    const rank: Record<OrderStatus, number> = {
      AWAITING_PAYMENT: 0, NEW: 1, PREPARING: 2, READY: 3, DELIVERING: 4, COMPLETED: 5, CANCELLED: 5,
    }
    for (const status of ORDER_STATUSES) {
      for (const fulfillmentType of FULFILLMENT_TYPES) {
        for (const target of advanceTargets({ status, fulfillmentType })) {
          expect(rank[target]).toBeGreaterThan(rank[status])
          expect(target).not.toBe('CANCELLED')
        }
      }
    }
  })
})

describe('primaryAction', () => {
  it.each([
    ['NEW', 'PICKUP', 'PREPARING', 'Bắt đầu làm'],
    ['PREPARING', 'DINE_IN', 'READY', 'Đã xong'],
    ['READY', 'DINE_IN', 'COMPLETED', 'Đã phục vụ'],
    ['READY', 'PICKUP', 'COMPLETED', 'Khách đã nhận'],
    ['READY', 'DELIVERY', 'DELIVERING', 'Đi giao'],
    ['DELIVERING', 'DELIVERY', 'COMPLETED', 'Đã giao xong'],
  ] as const)('%s / %s → %s "%s"', (status, fulfillmentType, nextStatus, label) => {
    expect(primaryAction({ status, fulfillmentType })).toEqual({ nextStatus, label })
  })

  it.each(['AWAITING_PAYMENT', 'COMPLETED', 'CANCELLED'] as const)('%s has no primary action', (status) => {
    for (const fulfillmentType of FULFILLMENT_TYPES) {
      expect(primaryAction({ status, fulfillmentType })).toBeNull()
    }
  })

  it('offers a skip-ahead label for NEW → READY', () => {
    expect(transitionLabel({ status: 'NEW', fulfillmentType: 'PICKUP' }, 'READY')).toBe('Xong luôn')
  })
})

describe('canCancelOrder (exhaustive)', () => {
  const CANCELLABLE = new Set<OrderStatus>(['AWAITING_PAYMENT', 'NEW', 'PREPARING'])
  const unpaid = new Set(['UNPAID', 'PENDING'])
  const cases = ORDER_STATUSES.flatMap(status =>
    PAYMENT_STATUSES.flatMap(paymentStatus => (['OWNER', 'STAFF'] as const).map(role => [status, paymentStatus, role] as const)),
  )

  it.each(cases)('%s / %s / %s', (status, paymentStatus, role) => {
    const expected = CANCELLABLE.has(status) && (role === 'OWNER' || unpaid.has(paymentStatus))
    expect(canCancelOrder({ status, paymentStatus }, role)).toBe(expected)
  })
})

describe('paymentStatusAfterCancel', () => {
  it.each(PAYMENT_STATUSES)('%s', (paymentStatus) => {
    expect(paymentStatusAfterCancel(paymentStatus)).toBe(paymentStatus === 'PAID' ? 'REFUND_DUE' : paymentStatus)
  })
})

describe('canMarkCashPaid', () => {
  it('only COD orders that are unpaid and not cancelled', () => {
    expect(canMarkCashPaid({ status: 'NEW', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(true)
    expect(canMarkCashPaid({ status: 'COMPLETED', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(true)
    expect(canMarkCashPaid({ status: 'CANCELLED', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'UNPAID' })).toBe(false)
    expect(canMarkCashPaid({ status: 'NEW', paymentMethod: 'PAY_ON_RECEIPT', paymentStatus: 'PAID' })).toBe(false)
    expect(canMarkCashPaid({ status: 'AWAITING_PAYMENT', paymentMethod: 'BANK_QR', paymentStatus: 'PENDING' })).toBe(false)
  })
})

describe('board tabs', () => {
  it('maps every status to exactly one tab', () => {
    for (const status of ORDER_STATUSES) {
      const owners = BOARD_TABS.filter(tab => TAB_STATUSES[tab].includes(status))
      expect(owners).toEqual([tabForStatus(status)])
    }
  })

  it('keeps AWAITING_PAYMENT out of the "new" queue', () => {
    expect(TAB_STATUSES.new).toEqual(['NEW'])
    expect(TAB_STATUSES.awaiting_payment).toEqual(['AWAITING_PAYMENT'])
    expect(tabForStatus('AWAITING_PAYMENT')).toBe('awaiting_payment')
  })
})
