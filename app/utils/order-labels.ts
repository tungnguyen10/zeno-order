import type { FulfillmentType, OrderStatus, PaymentMethod, PaymentStatus } from '#shared/enums'
import type { PublicOrderView } from '#shared/types/order'

export function customerStatusLabel(status: OrderStatus, fulfillmentType: FulfillmentType): string {
  switch (status) {
    case 'AWAITING_PAYMENT': return 'Chờ thanh toán'
    case 'NEW': return 'Đã gửi quán'
    case 'PREPARING': return 'Quán đang làm món'
    case 'READY':
      if (fulfillmentType === 'DELIVERY') return 'Món đã xong, chờ giao'
      return fulfillmentType === 'DINE_IN' ? 'Món đã xong' : 'Sẵn sàng, mời bạn lấy món'
    case 'DELIVERING': return 'Đang giao đến bạn'
    case 'COMPLETED': return 'Hoàn tất'
    case 'CANCELLED': return 'Quán đã hủy đơn'
  }
}

export function customerStatusTone(status: OrderStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'AWAITING_PAYMENT': return 'warning'
    case 'NEW': return 'info'
    case 'PREPARING': return 'warning'
    case 'READY': return 'success'
    case 'DELIVERING': return 'info'
    case 'COMPLETED': return 'success'
    case 'CANCELLED': return 'error'
  }
}

export function orderProgressSteps(fulfillmentType: FulfillmentType): OrderStatus[] {
  return fulfillmentType === 'DELIVERY'
    ? ['NEW', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']
    : ['NEW', 'PREPARING', 'READY', 'COMPLETED']
}

export function customerPaymentLabel(method: PaymentMethod, status: PaymentStatus): string {
  switch (status) {
    case 'PAID': return 'Đã thanh toán'
    case 'PENDING': return 'Chờ chuyển khoản'
    case 'REVIEW_REQUIRED': return 'Đang đối soát thanh toán'
    case 'REFUND_DUE': return 'Chờ hoàn tiền'
    case 'REFUNDED': return 'Đã hoàn tiền'
    case 'UNPAID': return method === 'PAY_ON_RECEIPT' ? 'Trả tiền khi nhận món' : 'Chưa thanh toán'
  }
}

export function fulfillmentSummary(view: Pick<PublicOrderView, 'fulfillmentType' | 'tableLabel' | 'deliveryZoneName'>): string {
  if (view.fulfillmentType === 'DINE_IN') return view.tableLabel ?? 'Tại bàn'
  if (view.fulfillmentType === 'PICKUP') return 'Mang đi'
  return view.deliveryZoneName ? `Giao hàng · ${view.deliveryZoneName}` : 'Giao hàng'
}
