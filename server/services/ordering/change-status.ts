import type { OrderStatus } from '#shared/enums'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { findOrderState, insertOrderEvent, transitionOrder } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'
import { nextStatuses } from './transitions'

export interface ChangeStatusInput {
  orderId: string
  expectedStatus: OrderStatus
  nextStatus: OrderStatus
}

export async function changeOrderStatus(db: Db, ctx: StoreContext, input: ChangeStatusInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    if (current.status !== input.expectedStatus) throw statusConflict({ currentStatus: current.status })

    const allowed = nextStatuses({ status: current.status, fulfillmentType: current.fulfillmentType }, ctx.role)
    // Hủy đi qua endpoint riêng vì bắt buộc có lý do và có quy tắc thu tiền.
    if (input.nextStatus === 'CANCELLED' || !allowed.includes(input.nextStatus)) {
      throw new AppError('VALIDATION_FAILED', 'Không thể chuyển sang trạng thái này', {
        reason: 'TRANSITION_NOT_ALLOWED',
        from: current.status,
        to: input.nextStatus,
      })
    }

    // Điểm duy nhất ngăn hai người cùng đổi một đơn: nếu người kia đã commit, WHERE status = expected không còn khớp.
    const updated = await transitionOrder(tx, scope, input.orderId, { from: input.expectedStatus, to: input.nextStatus })
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null })
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'STATUS_CHANGED',
      fromState: input.expectedStatus,
      toState: input.nextStatus,
    })
    return updated
  })
}
