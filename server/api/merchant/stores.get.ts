import { defineEventHandler } from 'h3'
import { createMerchantOrderRepository } from '../../repositories/merchant-order.repository'
import { requireMerchantClient } from '../../utils/merchant-auth'
import { merchantRepositoryError } from '../../utils/merchant-http'

export default defineEventHandler(async (event) => {
  const { client } = await requireMerchantClient(event)
  try {
    return { stores: await createMerchantOrderRepository(client).listStores() }
  }
  catch (error) {
    return merchantRepositoryError(error)
  }
})
