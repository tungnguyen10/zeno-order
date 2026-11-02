import type { OrderStatus } from '#shared/enums'
import { paymentStatusAfterCancel } from '#shared/order-flow'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { findOrderState, insertOrderEvent, transitionOrder } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'
import { canCancel } from './transitions'

export interface CancelOrderInput {
  orderId: string
  expectedStatus: OrderStatus
  reason: string
}

export async function cancelOrder(db: Db, ctx: StoreContext, input: CancelOrderInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (current.status !== input.expectedStatus) throw statusConflict({ currentStatus: current.status })

    const subject = { status: current.status, paymentStatus: current.paymentStatus }
    if (!canCancel(subject, ctx.role)) {
      if (canCancel(subject, 'OWNER')) throw new AppError('FORBIDDEN', 'Đơn đã thu tiền, chỉ chủ quán được hủy')
      throw new AppError('VALIDATION_FAILED', 'Không thể hủy đơn ở trạng thái này', {
        reason: 'TRANSITION_NOT_ALLOWED',
        from: current.status,
        to: 'CANCELLED',
      })
    }

    const nextPaymentStatus = paymentStatusAfterCancel(current.paymentStatus)
    // onlyIfPaymentStatus: nếu tiền vừa được ghi nhận sau khi ta đọc, việc hủy phải thất bại thay vì bỏ sót REFUND_DUE.
    const updated = await transitionOrder(tx, scope, input.orderId, {
      from: current.status,
      to: 'CANCELLED',
      onlyIfPaymentStatus: current.paymentStatus,
      setPaymentStatus: nextPaymentStatus,
    })
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null, currentPaymentStatus: latest?.paymentStatus ?? null })
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'CANCELLED',
      fromState: current.status,
      toState: 'CANCELLED',
      metadata: { reason: input.reason, paymentStatus: { from: current.paymentStatus, to: nextPaymentStatus } },
    })
    return updated
  })
}
