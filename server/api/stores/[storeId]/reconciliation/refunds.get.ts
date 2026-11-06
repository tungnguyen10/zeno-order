import { getRouterParam, setHeader } from 'h3'
import { requireStoreOwner } from '../../../../auth/guards'
import { getDb } from '../../../../db/client'
import { listRefundDueOrders } from '../../../../services/payments/manual-payments'
import { defineApiHandler } from '../../../../utils/api-handler'

export default defineApiHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store')
  const ctx = await requireStoreOwner(event, getRouterParam(event, 'storeId'))
  return { items: await listRefundDueOrders(getDb(), ctx) }
})
