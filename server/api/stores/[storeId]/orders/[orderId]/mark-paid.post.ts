import { getRouterParam } from 'h3'
import { markPaidSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { recordCashPayment } from '../../../../../services/ordering/record-cash-payment'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, markPaidSchema)
  return recordCashPayment(getDb(), ctx, { orderId, expectedPaymentStatus: body.expectedPaymentStatus, note: body.note })
})
