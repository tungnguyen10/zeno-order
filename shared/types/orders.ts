import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '../enums'
import type { BoardTab } from '../order-flow'

export interface BoardOrderItem {
  id: string
  name: string
  qty: number
  options: string[]
  unitPriceVnd: number
  lineTotalVnd: number
}

export interface BoardOrder {
  id: string
  publicCode: string
  status: OrderStatus
  fulfillmentType: FulfillmentType
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  latePayment: boolean
  tableName: string | null
  customerName: string | null
  customerPhone: string | null
  address: string | null
  notes: string | null
  totalVnd: number
  createdAt: string
  items: BoardOrderItem[]
}

export interface BoardResponse {
  orders: BoardOrder[]
  nextCursor: string | null
  counts: Record<BoardTab, number>
  newOrderIds: string[]
  serverTime: string
}

export interface OrderEventView {
  id: string
  eventType: string
  fromState: OrderStatus | null
  toState: OrderStatus | null
  actorName: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

export interface OrderPaymentView {
  method: 'CASH' | 'SEPAY' | 'BANK_MANUAL'
  amountVnd: number
  note: string | null
  recordedAt: string
}

export interface OrderDetailResponse {
  order: BoardOrder
  events: OrderEventView[]
  payment: OrderPaymentView | null
}

export interface OrderActionResult {
  id: string
  status: OrderStatus
  paymentStatus: PaymentStatus
}
