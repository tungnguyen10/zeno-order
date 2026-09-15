import { createError, defineEventHandler, readBody } from 'h3'
import { transitionOrderSchema } from '../../../../../../../shared/schemas/merchant'
import { createMerchantOrderRepository } from '../../../../../../repositories/merchant-order.repository'
import { requireMerchantClient } from '../../../../../../utils/merchant-auth'
import { merchantRepositoryError, requireOrderNumber, requireStoreId } from '../../../../../../utils/merchant-http'

export default defineEventHandler(async (event) => {
  const body = transitionOrderSchema.safeParse(await readBody(event))
  if (!body.success) throw createError({ statusCode: 400, statusMessage: 'Trạng thái đơn không hợp lệ.' })
  const storeId = requireStoreId(event)
  const orderNumber = requireOrderNumber(event)
  const { client } = await requireMerchantClient(event)
  try {
    return await createMerchantOrderRepository(client).transition(
      storeId,
      orderNumber,
      body.data.status,
      body.data.note ?? null,
    )
  }
  catch (error) {
    return merchantRepositoryError(error)
  }
})
