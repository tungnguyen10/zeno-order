export const BANK_TX_STATUSES = ['RECEIVED', 'MATCHED', 'REVIEW_REQUIRED', 'IGNORED', 'RESOLVED'] as const
export type BankTxStatus = (typeof BANK_TX_STATUSES)[number]

export const BANK_TX_SOURCES = ['WEBHOOK', 'RECONCILE'] as const
export type BankTxSource = (typeof BANK_TX_SOURCES)[number]

export const BANK_TX_DIRECTIONS = ['IN', 'OUT'] as const
export type BankTxDirection = (typeof BANK_TX_DIRECTIONS)[number]

export const REVIEW_REASONS = [
  'NO_CODE',
  'UNKNOWN_CODE',
  'ACCOUNT_MISMATCH',
  'AMOUNT_UNDER',
  'AMOUNT_OVER',
  'ORDER_CANCELLED',
  'ORDER_ALREADY_PAID',
  'ORDER_NOT_PAYABLE',
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const RESOLUTIONS = ['REFUNDED_OUTSIDE', 'NOT_ORDER', 'DUPLICATE', 'OTHER'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const BANK_TX_ACTIONS = ['RECEIVED', 'ALIAS_ADDED', 'MATCHED', 'REVIEW_REQUIRED', 'ASSIGNED', 'RESOLVED', 'IGNORED'] as const
export type BankTxAction = (typeof BANK_TX_ACTIONS)[number]

export const REVIEW_REASON_LABEL: Record<ReviewReason, string> = {
  NO_CODE: 'Không thấy mã thanh toán trong nội dung chuyển khoản',
  UNKNOWN_CODE: 'Mã thanh toán không thuộc đơn nào của quán',
  ACCOUNT_MISMATCH: 'Tiền vào tài khoản khác với tài khoản của đơn',
  AMOUNT_UNDER: 'Khách chuyển thiếu tiền',
  AMOUNT_OVER: 'Khách chuyển thừa tiền',
  ORDER_CANCELLED: 'Đơn đã hủy nhưng khách vẫn chuyển tiền',
  ORDER_ALREADY_PAID: 'Đơn đã được thanh toán, đây là khoản chuyển thêm',
  ORDER_NOT_PAYABLE: 'Đơn không còn ở trạng thái chờ thanh toán',
}

export const RESOLUTION_LABEL: Record<Resolution, string> = {
  REFUNDED_OUTSIDE: 'Đã hoàn tiền cho khách',
  NOT_ORDER: 'Không phải tiền của đơn',
  DUPLICATE: 'Giao dịch trùng',
  OTHER: 'Khác',
}
