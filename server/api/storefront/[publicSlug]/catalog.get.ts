import type { H3Event } from 'h3'

import {
  createError,
  defineEventHandler,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from 'h3'

import { createPublicCatalogService } from '../../../domain/catalog/public-catalog'
import { StoreNotFoundError } from '../../../domain/store/public-store'
import {
  createCatalogRepository,
  type PublicCatalogRpcClient,
} from '../../../repositories/catalog.repository'
import { createPublicSupabaseClient } from '../../../utils/public-supabase-client'

export const STOREFRONT_CATALOG_CACHE_CONTROL = 'public, max-age=0, s-maxage=120, stale-while-revalidate=60'

interface CatalogResolver {
  resolve: (publicSlug: string, event: H3Event) => Promise<unknown>
}

export function createCatalogEventHandler(resolver: CatalogResolver) {
  return async (event: H3Event) => {
    try {
      const payload = await resolver.resolve(
        getRouterParam(event, 'publicSlug') ?? '',
        event,
      )
      setResponseHeader(event, 'Cache-Control', STOREFRONT_CATALOG_CACHE_CONTROL)
      return payload
    }
    catch (error) {
      if (error instanceof StoreNotFoundError) {
        setResponseHeader(event, 'Cache-Control', STOREFRONT_CATALOG_CACHE_CONTROL)
        setResponseStatus(event, error.statusCode)
        return {
          error: {
            code: error.code,
            message: error.message,
          },
        }
      }

      setResponseHeader(event, 'Cache-Control', 'no-store')
      throw createError({
        statusCode: 500,
        statusMessage: 'Không thể tải thực đơn.',
      })
    }
  }
}

export default defineEventHandler(createCatalogEventHandler({
  async resolve(publicSlug, event) {
    const config = useRuntimeConfig(event)
    const client = createPublicSupabaseClient({
      url: config.public.supabase.url,
      key: config.public.supabase.key,
    })
    const repository = createCatalogRepository(client as unknown as PublicCatalogRpcClient)
    return createPublicCatalogService(repository).resolve(publicSlug)
  },
}))
