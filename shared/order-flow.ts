import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from './enums'

export const BOARD_TABS = ['new', 'doing', 'ready', 'other', 'awaiting_payment'] as const
export type BoardTab = (typeof BOARD_TABS)[number]

export const TAB_STATUSES: Record<BoardTab, readonly OrderStatus[]> = {
  new: ['NEW'],
  doing: ['PREPARING'],
  ready: ['READY', 'DELIVERING'],
  other: ['COMPLETED', 'CANCELLED'],
  awaiting_payment: ['AWAITING_PAYMENT'],
}

export const TAB_LABELS: Record<BoardTab, string> = {
  new: 'Mới',
  doing: 'Đang làm',
  ready: 'Sẵn sàng',
  other: 'Khác',
  awaiting_payment: 'Chờ thanh toán',
}

export const STATUS_LABELS: Record<OrderStatus, string> = {
  AWAITING_PAYMENT: 'Chờ thanh toán',
  NEW: 'Mới',
  PREPARING: 'Đang làm',
  READY: 'Sẵn sàng',
  DELIVERING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã hủy',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: 'Chưa thu',
  PENDING: 'Chờ chuyển khoản',
  PAID: 'Đã thu',
  REVIEW_REQUIRED: 'Cần kiểm tra',
  REFUND_DUE: 'Cần hoàn tiền',
  REFUNDED: 'Đã hoàn tiền',
}

export const FULFILLMENT_LABELS: Record<FulfillmentType, string> = {
  DINE_IN: 'Tại bàn',
  PICKUP: 'Mang đi',
  DELIVERY: 'Giao hàng',
}

export type OrderEventType = 'STATUS_CHANGED' | 'CANCELLED' | 'PAYMENT_RECORDED'

export function tabForStatus(status: OrderStatus): BoardTab {
  const tab = BOARD_TABS.find(candidate => TAB_STATUSES[candidate].includes(status))
  if (!tab) throw new Error(`No board tab for status ${status}`)
  return tab
}

export interface FlowOrder {
  status: OrderStatus
  fulfillmentType: FulfillmentType
}

/** Các bước tiến mà nhân viên được bấm. Không gồm hủy và bước hệ thống (AWAITING_PAYMENT → NEW). */
export function advanceTargets(order: FlowOrder): OrderStatus[] {
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

export function transitionLabel(order: FlowOrder, to: OrderStatus): string {
  if (to === 'PREPARING') return 'Bắt đầu làm'
  if (to === 'READY') return order.status === 'NEW' ? 'Xong luôn' : 'Đã xong'
  if (to === 'DELIVERING') return 'Đi giao'
  if (to === 'COMPLETED') {
    if (order.fulfillmentType === 'DELIVERY') return 'Đã giao xong'
    return order.fulfillmentType === 'PICKUP' ? 'Khách đã nhận' : 'Đã phục vụ'
  }
  return STATUS_LABELS[to]
}

export function primaryAction(order: FlowOrder): { nextStatus: OrderStatus, label: string } | null {
  const [nextStatus] = advanceTargets(order)
  return nextStatus ? { nextStatus, label: transitionLabel(order, nextStatus) } : null
}

const CANCELLABLE: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'NEW', 'PREPARING']

export function canCancelOrder(order: { status: OrderStatus, paymentStatus: PaymentStatus }, role: 'OWNER' | 'STAFF'): boolean {
  if (!CANCELLABLE.includes(order.status)) return false
  if (role === 'OWNER') return true
  return order.paymentStatus === 'UNPAID' || order.paymentStatus === 'PENDING'
}

export function paymentStatusAfterCancel(current: PaymentStatus): PaymentStatus {
  return current === 'PAID' ? 'REFUND_DUE' : current
}

export function canMarkCashPaid(order: { status: OrderStatus, paymentMethod: PaymentMethod, paymentStatus: PaymentStatus }): boolean {
  return order.paymentMethod === 'PAY_ON_RECEIPT' && order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED'
}
