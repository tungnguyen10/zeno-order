import type { PaymentStatus } from '#shared/enums'
import type { OrderActionResult } from '#shared/types/orders'
import type { StoreContext } from '../../auth/guards'
import type { Db } from '../../db/client'
import { isUniqueViolation } from '../../db/errors'
import { findOrderState, insertCashPayment, insertOrderEvent, markOrderPaid } from '../../repositories/orders'
import { AppError } from '../../utils/errors'
import { statusConflict } from './conflicts'

export interface RecordCashPaymentInput {
  orderId: string
  expectedPaymentStatus: PaymentStatus
  note?: string
}

export async function recordCashPayment(db: Db, ctx: StoreContext, input: RecordCashPaymentInput): Promise<OrderActionResult> {
  const scope = { orgId: ctx.orgId, storeId: ctx.storeId }
  const note = input.note?.trim() ? input.note.trim() : null
  return db.transaction(async (tx) => {
    const current = await findOrderState(tx, scope, input.orderId)
    if (!current) throw new AppError('NOT_FOUND', 'Không tìm thấy')
    const conflict = () => statusConflict({ currentStatus: current.status, currentPaymentStatus: current.paymentStatus })
    if (current.paymentStatus !== input.expectedPaymentStatus || current.status === 'CANCELLED') throw conflict()
    if (current.paymentMethod !== 'PAY_ON_RECEIPT') {
      throw new AppError('VALIDATION_FAILED', 'Chỉ ghi nhận thu tiền mặt cho đơn trả khi nhận', { reason: 'NOT_COD' })
    }
    if (current.paymentStatus !== 'UNPAID') throw conflict()

    const updated = await markOrderPaid(tx, scope, input.orderId, 'UNPAID')
    if (!updated) {
      const latest = await findOrderState(tx, scope, input.orderId)
      throw statusConflict({ currentStatus: latest?.status ?? null, currentPaymentStatus: latest?.paymentStatus ?? null })
    }

    try {
      await insertCashPayment(tx, scope, { orderId: input.orderId, amountVnd: current.totalVnd, recordedBy: ctx.userId, note })
    }
    catch (err) {
      if (isUniqueViolation(err, 'order_payments_order_uq')) throw conflict()
      throw err
    }

    await insertOrderEvent(tx, scope, {
      orderId: input.orderId,
      actorUserId: ctx.userId,
      eventType: 'PAYMENT_RECORDED',
      metadata: { method: 'CASH', amountVnd: current.totalVnd, paymentStatus: { from: 'UNPAID', to: 'PAID' }, ...(note ? { note } : {}) },
    })
    return updated
  })
}
