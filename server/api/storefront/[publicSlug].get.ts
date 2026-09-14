import { serverSupabaseClient } from '#supabase/server'
import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseStatus,
} from 'h3'

import {
  createPublicStoreService,
  StoreNotFoundError,
} from '../../domain/store/public-store'
import {
  createStoreRepository,
  type PublicStoreRpcClient,
} from '../../repositories/store.repository'

export default defineEventHandler(async (event) => {
  const client = await serverSupabaseClient(event)
  const repository = createStoreRepository(client as unknown as PublicStoreRpcClient)
  const service = createPublicStoreService(repository)

  try {
    return await service.resolve(getRouterParam(event, 'publicSlug') ?? '')
  }
  catch (error) {
    if (error instanceof StoreNotFoundError) {
      setResponseStatus(event, error.statusCode)
      return {
        error: {
          code: error.code,
          message: error.message,
        },
      }
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Không thể tải thông tin cửa hàng.',
    })
  }
})
