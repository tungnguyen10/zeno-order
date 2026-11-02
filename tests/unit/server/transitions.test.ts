import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES, type FulfillmentType, type OrderStatus, type PaymentStatus } from '#shared/enums'
import { canCancel, nextStatuses, type ActorRole } from '../../../server/services/ordering/transitions'

const ROLES: ActorRole[] = ['OWNER', 'STAFF', 'SYSTEM']

describe('nextStatuses', () => {
  it.each<[OrderStatus, FulfillmentType, ActorRole, OrderStatus[]]>([
    ['AWAITING_PAYMENT', 'PICKUP', 'SYSTEM', ['NEW']],
    ['AWAITING_PAYMENT', 'DELIVERY', 'STAFF', []],
    ['AWAITING_PAYMENT', 'DINE_IN', 'OWNER', []],
    ['NEW', 'PICKUP', 'STAFF', ['PREPARING', 'READY']],
    ['NEW', 'DELIVERY', 'OWNER', ['PREPARING', 'READY']],
    ['NEW', 'DINE_IN', 'SYSTEM', []],
    ['PREPARING', 'PICKUP', 'STAFF', ['READY']],
    ['PREPARING', 'DELIVERY', 'SYSTEM', []],
    ['READY', 'DINE_IN', 'STAFF', ['COMPLETED']],
    ['READY', 'PICKUP', 'OWNER', ['COMPLETED']],
    ['READY', 'DELIVERY', 'STAFF', ['DELIVERING']],
    ['DELIVERING', 'DELIVERY', 'STAFF', ['COMPLETED']],
    ['COMPLETED', 'PICKUP', 'OWNER', []],
    ['CANCELLED', 'DELIVERY', 'OWNER', []],
    ['COMPLETED', 'DELIVERY', 'SYSTEM', []],
  ])('%s (%s) as %s → %j', (status, fulfillmentType, role, expected) => {
    expect(nextStatuses({ status, fulfillmentType }, role)).toEqual(expected)
  })

  it('never moves backwards, never cancels, never returns to AWAITING_PAYMENT', () => {
    for (const status of ORDER_STATUSES) {
      for (const fulfillmentType of FULFILLMENT_TYPES) {
        for (const role of ROLES) {
          for (const next of nextStatuses({ status, fulfillmentType }, role)) {
            expect(next).not.toBe('CANCELLED')
            expect(next).not.toBe('AWAITING_PAYMENT')
            expect(ORDER_STATUSES.indexOf(next)).toBeGreaterThan(ORDER_STATUSES.indexOf(status))
          }
        }
      }
    }
  })

  it('only delivery orders pass through DELIVERING', () => {
    for (const fulfillmentType of ['DINE_IN', 'PICKUP'] as const) {
      expect(nextStatuses({ status: 'READY', fulfillmentType }, 'STAFF')).not.toContain('DELIVERING')
    }
  })
})

describe('canCancel', () => {
  const CANCELLABLE: OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']

  it.each(CANCELLABLE.flatMap(status => PAYMENT_STATUSES.map(paymentStatus => [status, paymentStatus] as const)))(
    'owner may cancel %s / %s',
    (status, paymentStatus) => {
      expect(canCancel({ status, paymentStatus }, 'OWNER')).toBe(true)
    },
  )

  it.each(CANCELLABLE.flatMap(status => PAYMENT_STATUSES.map(paymentStatus => [status, paymentStatus] as const)))(
    'staff may cancel %s / %s only while nothing was collected',
    (status, paymentStatus) => {
      const expected: PaymentStatus[] = ['UNPAID', 'PENDING']
      expect(canCancel({ status, paymentStatus }, 'STAFF')).toBe(expected.includes(paymentStatus))
    },
  )

  it('system can only cancel an order that is still awaiting payment', () => {
    expect(canCancel({ status: 'AWAITING_PAYMENT', paymentStatus: 'PENDING' }, 'SYSTEM')).toBe(true)
    expect(canCancel({ status: 'NEW', paymentStatus: 'UNPAID' }, 'SYSTEM')).toBe(false)
  })

  it.each(['READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const)('nobody cancels a %s order', (status) => {
    for (const paymentStatus of PAYMENT_STATUSES) {
      for (const role of ROLES) expect(canCancel({ status, paymentStatus }, role)).toBe(false)
    }
  })
})
