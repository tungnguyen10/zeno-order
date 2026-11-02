import { getRouterParam } from 'h3'
import { statusChangeSchema } from '#shared/schemas/orders'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { changeOrderStatus } from '../../../../../services/ordering/change-status'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'
import { parseBody } from '../../../../../utils/validation'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  const body = await parseBody(event, statusChangeSchema)
  return changeOrderStatus(getDb(), ctx, { orderId, ...body })
})
