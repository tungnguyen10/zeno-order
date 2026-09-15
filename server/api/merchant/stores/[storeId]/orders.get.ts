import { createError, defineEventHandler, getQuery } from 'h3'
import { orderListQuerySchema } from '../../../../../shared/schemas/merchant'
import { createMerchantOrderRepository } from '../../../../repositories/merchant-order.repository'
import { requireMerchantClient } from '../../../../utils/merchant-auth'
import { merchantRepositoryError, requireStoreId } from '../../../../utils/merchant-http'

export default defineEventHandler(async (event) => {
  const parsed = orderListQuerySchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: 'Bộ lọc đơn hàng không hợp lệ.' })
  const storeId = requireStoreId(event)
  const { client } = await requireMerchantClient(event)
  try {
    return {
      orders: await createMerchantOrderRepository(client).listOrders(storeId, parsed.data.status, parsed.data.limit),
    }
  }
  catch (error) {
    return merchantRepositoryError(error)
  }
})
