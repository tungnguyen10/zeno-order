import type { FulfillmentType, OrderStatus, PaymentStatus } from '#shared/enums'
import type { StoreRole } from '#shared/types/identity'

export type ActorRole = StoreRole | 'SYSTEM'

const CANCELLABLE_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']
const STAFF_CANCEL_PAYMENT: readonly PaymentStatus[] = ['UNPAID', 'PENDING']

export function nextStatuses(order: { status: OrderStatus, fulfillmentType: FulfillmentType }, actorRole: ActorRole): OrderStatus[] {
  if (actorRole === 'SYSTEM') return order.status === 'AWAITING_PAYMENT' ? ['NEW'] : []

  switch (order.status) {
    case 'NEW':
      return ['PREPARING', 'READY']
    case 'PREPARING':
      return ['READY']
    case 'READY':
      return order.fulfillmentType === 'DELIVERY' ? ['DELIVERING'] : ['COMPLETED']
    case 'DELIVERING':
      return ['COMPLETED']
    default:
      return []
  }
}

export function canCancel(order: { status: OrderStatus, paymentStatus: PaymentStatus }, actorRole: ActorRole): boolean {
  if (!CANCELLABLE_STATUSES.includes(order.status)) return false
  if (actorRole === 'SYSTEM') return order.status === 'AWAITING_PAYMENT'
  if (actorRole === 'OWNER') return true
  return STAFF_CANCEL_PAYMENT.includes(order.paymentStatus)
}
