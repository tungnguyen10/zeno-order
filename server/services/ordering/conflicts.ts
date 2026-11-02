import type { OrderStatus, PaymentStatus } from '#shared/enums'
import { AppError } from '../../utils/errors'

export function statusConflict(details: { currentStatus?: OrderStatus | null, currentPaymentStatus?: PaymentStatus | null }): AppError {
  return new AppError('STATUS_CONFLICT', 'Đơn vừa được người khác cập nhật, vui lòng tải lại', details)
}
