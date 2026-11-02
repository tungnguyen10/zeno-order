import { describe, expect, it } from 'vitest'
import { FULFILLMENT_TYPES, ORDER_STATUSES, PAYMENT_STATUSES } from '../../../shared/enums'
import { advanceTargets, canCancelOrder } from '../../../shared/order-flow'
import { canCancel, nextStatuses } from '../../../server/services/ordering/transitions'

// Khóa hai bản (server PR3 và shared PR4) không được lệch nhau.
describe('shared order-flow vs server transitions', () => {
  const roles = ['OWNER', 'STAFF'] as const

  it.each(ORDER_STATUSES.flatMap(status => FULFILLMENT_TYPES.flatMap(fulfillmentType => roles.map(role => [status, fulfillmentType, role] as const))))(
    'nextStatuses %s / %s / %s (không tính CANCELLED)',
    (status, fulfillmentType, role) => {
      const server = nextStatuses({ status, fulfillmentType }, role).filter(next => next !== 'CANCELLED').sort()
      expect(server).toEqual([...advanceTargets({ status, fulfillmentType })].sort())
    },
  )

  it.each(ORDER_STATUSES.flatMap(status => PAYMENT_STATUSES.flatMap(paymentStatus => roles.map(role => [status, paymentStatus, role] as const))))(
    'canCancel %s / %s / %s',
    (status, paymentStatus, role) => {
      expect(canCancel({ status, paymentStatus }, role)).toBe(canCancelOrder({ status, paymentStatus }, role))
    },
  )
})
