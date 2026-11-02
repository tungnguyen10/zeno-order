import { getRouterParam } from 'h3'
import { cancelOrderSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { cancelOrder } from '../../../../../services/ordering/cancel-order'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, cancelOrderSchema)
  return cancelOrder(getDb(), ctx, { orderId, ...body })
})
