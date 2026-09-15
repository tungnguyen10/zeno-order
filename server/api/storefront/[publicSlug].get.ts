import {
  createPublicStoreService,
  StoreNotFoundError,
} from '../../domain/store/public-store'
import {
  createStoreRepository,
  type PublicStoreRpcClient,
} from '../../repositories/store.repository'
import { createPublicSupabaseClient } from '../../utils/public-supabase-client'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const client = createPublicSupabaseClient({
    url: config.public.supabase.url,
    key: config.public.supabase.key,
  })
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
