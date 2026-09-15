import { createError, defineEventHandler } from 'h3'
import { createMerchantOrderRepository } from '../../../../../repositories/merchant-order.repository'
import { requireMerchantClient } from '../../../../../utils/merchant-auth'
import { merchantRepositoryError, requireOrderNumber, requireStoreId } from '../../../../../utils/merchant-http'

export default defineEventHandler(async (event) => {
  const storeId = requireStoreId(event)
  const orderNumber = requireOrderNumber(event)
  const { client } = await requireMerchantClient(event)
  try {
    const order = await createMerchantOrderRepository(client).findOrder(storeId, orderNumber)
    if (!order) throw createError({ statusCode: 404, statusMessage: 'Không tìm thấy đơn hàng.' })
    return order
  }
  catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    return merchantRepositoryError(error)
  }
})
