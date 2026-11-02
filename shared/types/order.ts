import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '../enums'

export interface OrderItemOptionSnapshot {
  groupId: string
  groupName: string
  valueId: string
  valueName: string
  priceDeltaVnd: number
}

export type CartStaleReason = 'PRODUCT_UNAVAILABLE' | 'OPTION_INVALID' | 'PRICE_CHANGED'

export interface CartStaleLine {
  /** Index of the offending line in the submitted `items` array. */
  index: number
  productId: string
  name: string | null
  reason: CartStaleReason
  currentUnitPriceVnd: number | null
}

export interface CartStaleDetails {
  lines: CartStaleLine[]
  /** Current fee of the chosen zone; null for non-delivery orders. */
  deliveryFeeVnd: number | null
  /** Current total; null while some line is still stale. */
  totalVnd: number | null
}

export interface PaymentQr {
  bankName: string
  accountNumber: string
  accountHolder: string
  amountVnd: number
  transferContent: string
  imageUrl: string
  expiresAt: string
}

export interface CreateOrderResponse {
  publicCode: string
  guestToken: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  totalVnd: number
  qr?: PaymentQr
}

export interface PublicOrderItem {
  name: string
  quantity: number
  unitPriceVnd: number
  lineTotalVnd: number
  options: { name: string, priceDeltaVnd: number }[]
  note: string | null
}

export interface PublicOrderView {
  publicCode: string
  status: OrderStatus
  paymentStatus: PaymentStatus
  paymentMethod: PaymentMethod
  fulfillmentType: FulfillmentType
  tableLabel: string | null
  deliveryZoneName: string | null
  customerName: string | null
  phoneMasked: string | null
  items: PublicOrderItem[]
  subtotalVnd: number
  deliveryFeeVnd: number
  totalVnd: number
  createdAt: string
  store: { name: string, slug: string }
  qr: PaymentQr | null
}
