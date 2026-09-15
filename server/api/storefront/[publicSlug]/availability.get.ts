import type { H3Event } from 'h3'

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from 'h3'

import { createStoreAvailabilityService } from '../../../domain/availability/store-availability'
import { StoreNotFoundError } from '../../../domain/store/public-store'
import {
  createAvailabilityRepository,
  type AvailabilityRpcClient,
} from '../../../repositories/availability.repository'
import { createPublicSupabaseClient } from '../../../utils/public-supabase-client'

interface AvailabilityResolver {
  resolve: (publicSlug: string, now: Date, event: H3Event) => Promise<unknown>
}

export function createAvailabilityEventHandler(resolver: AvailabilityResolver) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'Cache-Control', 'no-store')

    try {
      return await resolver.resolve(
        getRouterParam(event, 'publicSlug') ?? '',
        new Date(),
        event,
      )
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
        statusMessage: 'Không thể tải tình trạng cửa hàng.',
      })
    }
  }
}

export default defineEventHandler(createAvailabilityEventHandler({
  async resolve(publicSlug, now, event) {
    const config = useRuntimeConfig(event)
    const client = createPublicSupabaseClient({
      url: config.public.supabase.url,
      key: config.public.supabase.key,
    })
    const repository = createAvailabilityRepository(client as unknown as AvailabilityRpcClient)
    return createStoreAvailabilityService(repository).resolve(publicSlug, now)
  },
}))
