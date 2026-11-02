import { getRouterParam, setHeader } from 'h3'
import { requireStoreStaff } from '../../../../../auth/guards'
import { getDb } from '../../../../../db/client'
import { getOrderDetail } from '../../../../../services/ordering/board'
import { defineApiHandler } from '../../../../../utils/api-handler'
import { requireUuidParam } from '../../../../../utils/ids'

export default defineApiHandler(async (event) => {
  const ctx = await requireStoreStaff(event, getRouterParam(event, 'storeId'))
  const orderId = requireUuidParam(event, 'orderId')
  setHeader(event, 'Cache-Control', 'no-store')
  return getOrderDetail(getDb(), ctx, orderId)
})
