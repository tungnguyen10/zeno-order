import type { OrderStatus } from '../../shared/types/merchant'

export const orderStatusLabel: Record<OrderStatus, string> = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  preparing: 'Đang chuẩn bị',
  ready: 'Sẵn sàng',
  delivering: 'Đang giao',
  completed: 'Hoàn tất',
  cancelled: 'Đã hủy',
}

export function nextOrderStatuses(status: OrderStatus, fulfillmentType: 'delivery' | 'pickup'): OrderStatus[] {
  switch (status) {
    case 'pending': return ['confirmed', 'cancelled']
    case 'confirmed': return ['preparing', 'cancelled']
    case 'preparing': return ['ready', 'cancelled']
    case 'ready': return [fulfillmentType === 'delivery' ? 'delivering' : 'completed', 'cancelled']
    case 'delivering': return ['completed', 'cancelled']
    default: return []
  }
}
