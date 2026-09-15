import type { H3Event } from 'h3'

import {
  createError,
  defineEventHandler,
  getHeader,
  getRouterParam,
  setResponseHeader,
  setResponseStatus,
} from 'h3'

import { createTrackingRepository, type TrackingRpcClient } from '../../../../repositories/tracking.repository'
import { sha256Hex } from '../../../../utils/order-crypto'
import { createPublicSupabaseClient } from '../../../../utils/public-supabase-client'

const notFound = { error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' } }
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const orderNumberPattern = /^[A-Z][A-Z0-9-]{3,31}$/
const tokenPattern = /^[A-Za-z0-9_-]{43}$/

interface TrackingResolver {
  resolve: (publicSlug: string, orderNumber: string, tokenHash: string) => Promise<unknown | null>
}

export function createOrderTrackingEventHandler(resolver: TrackingResolver) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    const publicSlug = getRouterParam(event, 'publicSlug') ?? ''
    const orderNumber = getRouterParam(event, 'orderNumber') ?? ''
    const authorization = getHeader(event, 'authorization') ?? ''
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''

    if (!slugPattern.test(publicSlug) || !orderNumberPattern.test(orderNumber) || !tokenPattern.test(token)) {
      setResponseStatus(event, 404)
      return notFound
    }

    try {
      const payload = await resolver.resolve(publicSlug, orderNumber, sha256Hex(token))
      if (!payload) {
        setResponseStatus(event, 404)
        return notFound
      }
      return payload
    }
    catch {
      throw createError({ statusCode: 500, statusMessage: 'Không thể tải đơn hàng.' })
    }
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const client = createPublicSupabaseClient({
    url: config.public.supabase.url,
    key: config.public.supabase.key,
  })
  const repository = createTrackingRepository(client as unknown as TrackingRpcClient)
  return createOrderTrackingEventHandler({ resolve: repository.find })(event)
})
