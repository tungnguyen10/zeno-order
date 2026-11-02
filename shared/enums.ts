export const FULFILLMENT_TYPES = ['DINE_IN', 'PICKUP', 'DELIVERY'] as const
export type FulfillmentType = (typeof FULFILLMENT_TYPES)[number]

export const ORDER_STATUSES = ['AWAITING_PAYMENT', 'NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED', 'CANCELLED'] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const PAYMENT_METHODS = ['BANK_QR', 'PAY_ON_RECEIPT'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_STATUSES = ['UNPAID', 'PENDING', 'PAID', 'REVIEW_REQUIRED', 'REFUND_DUE', 'REFUNDED'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

const TERMINAL_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED']

export function isTerminalStatus(status: OrderStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}
