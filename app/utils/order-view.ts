import type { PaymentStatus } from '#shared/enums'
import { STATUS_LABELS } from '#shared/order-flow'
import type { OrderEventView } from '#shared/types/orders'
import { extractApiError } from './api-error'

export const PAYMENT_METHOD_LABELS = {
  CASH: 'tiền mặt',
  SEPAY: 'chuyển khoản',
  BANK_MANUAL: 'chuyển khoản (chủ quán xác nhận)',
} as const

export function orderActionToast(err: unknown): { color: 'warning' | 'error', title: string, description?: string } {
  const error = extractApiError(err)
  if (error.code === 'STATUS_CONFLICT') {
    return { color: 'warning', title: 'Đơn vừa được người khác cập nhật', description: 'Đã tải lại danh sách.' }
  }
  if (error.code === 'FORBIDDEN') return { color: 'error', title: 'Bạn không có quyền thực hiện thao tác này' }
  return { color: 'error', title: error.message }
}

export function paymentTone(status: PaymentStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'PAID': return 'success'
    case 'UNPAID': return 'warning'
    case 'PENDING': return 'info'
    case 'REVIEW_REQUIRED':
    case 'REFUND_DUE': return 'error'
    default: return 'neutral'
  }
}

export function describeEvent(event: OrderEventView): string {
  if (event.eventType === 'CANCELLED') {
    const reason = typeof event.metadata?.reason === 'string' ? event.metadata.reason : ''
    return reason ? `Đã hủy — ${reason}` : 'Đã hủy'
  }
  if (event.eventType === 'PAYMENT_RECORDED') return 'Đã thu tiền mặt'
  if (event.eventType === 'CREATED') return 'Khách đặt đơn'
  return event.toState ? STATUS_LABELS[event.toState] : event.eventType
}

const DATE_TIME = new Intl.DateTimeFormat('vi-VN', {
  hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh',
})

export function formatDateTime(iso: string): string {
  const parts = Object.fromEntries(DATE_TIME.formatToParts(new Date(iso)).map(part => [part.type, part.value]))
  return `${parts.hour}:${parts.minute} ${parts.day}/${parts.month}`
}
