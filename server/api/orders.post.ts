import type { H3Event } from 'h3'

import { randomUUID } from 'node:crypto'
import {
  createError,
  defineEventHandler,
  getRequestIP,
  readBody,
  setResponseHeader,
  setResponseStatus,
} from 'h3'

import { createOrderService, OrderRequestError } from '../domain/order/create-order'
import { createOrderRepository } from '../repositories/order.repository'
import { parseOrderServerEnvironment } from '../utils/order-environment'
import { createOrderSupabaseClient } from '../utils/order-supabase-client'
import { createTurnstileVerifier } from '../utils/turnstile'

interface OrdersHandlerDependencies {
  submit: (input: unknown, clientIp: string) => Promise<unknown>
  readRequest: (event: H3Event) => Promise<unknown>
  getClientIp: (event: H3Event) => string
}

export function createOrdersEventHandler(dependencies: OrdersHandlerDependencies) {
  return async (event: H3Event) => {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    try {
      return await dependencies.submit(
        await dependencies.readRequest(event),
        dependencies.getClientIp(event),
      )
    }
    catch (error) {
      if (error instanceof OrderRequestError) {
        setResponseStatus(event, error.statusCode)
        if (error.retryAfter) {
          setResponseHeader(event, 'Retry-After', error.retryAfter)
        }
        return { error: { code: error.code, message: error.message } }
      }
      throw createError({ statusCode: 500, statusMessage: 'Không thể tạo đơn hàng.' })
    }
  }
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const environment = parseOrderServerEnvironment({
    supabaseSecretKey: config.supabase.secretKey,
    turnstileSecretKey: config.turnstile.secretKey,
    rateLimitMax: config.order.rateLimitMax,
    rateLimitWindowSeconds: config.order.rateLimitWindowSeconds,
    trackingKeyVersion: config.tracking.keyVersion,
    trackingSecretsJson: config.tracking.secretsJson,
  })
  const client = createOrderSupabaseClient({
    url: config.public.supabase.url,
    secretKey: environment.supabaseSecretKey,
  })
  const repository = createOrderRepository(client)
  const service = createOrderService({
    ...repository,
    verifyTurnstile: createTurnstileVerifier(environment.turnstileSecretKey),
    createOrderId: randomUUID,
  }, environment)

  return createOrdersEventHandler({
    submit: service.submit,
    readRequest: readBody,
    getClientIp: target => getRequestIP(target, { xForwardedFor: true }) ?? 'unknown',
  })(event)
})
