import { createOrderRequestSchema, orderRequestHashInput } from '#shared/schemas/create-order'
import type { CreateOrderRequest } from '#shared/schemas/create-order'

import { canonicalJson, createTrackingToken, sha256Hex } from '../../utils/order-crypto'

interface RateLimitResult {
  allowed: boolean
  retryAfter: number
}

export interface OrderRequestContext {
  storeId: string
  requestHash: string | null
  orderId: string | null
  orderNumber: string | null
  trackingKeyVersion: number | null
}

export interface AtomicOrderInput {
  publicSlug: string
  orderId: string
  idempotencyKey: string
  requestHash: string
  trackingTokenHash: string
  trackingKeyVersion: number
  fulfillmentType: 'delivery' | 'pickup'
  customerName: string
  customerPhone: string
  deliveryAddress: string | null
  deliveryNote: string | null
  customerNote: string | null
  paymentMethod: 'cash' | 'bank_transfer'
  items: CreateOrderRequest['items']
}

export interface AtomicOrderResult {
  storeId: string
  orderId: string
  orderNumber: string
  trackingKeyVersion: number
}

export interface CreateOrderDependencies {
  consumeRateLimit: (input: {
    scope: string
    keyHash: string
    limit: number
    windowSeconds: number
  }) => Promise<RateLimitResult>
  getRequestContext: (publicSlug: string, idempotencyKey: string) => Promise<OrderRequestContext | null>
  verifyTurnstile: (input: {
    token: string
    remoteIp: string
    idempotencyKey: string
  }) => Promise<boolean>
  createAtomicOrder: (input: AtomicOrderInput) => Promise<AtomicOrderResult>
  createOrderId: () => string
}

interface CreateOrderConfig {
  rateLimitMax: number
  rateLimitWindowSeconds: number
  trackingKeyVersion: number
  trackingSecrets: Record<string | number, string>
}

export class OrderRequestError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message)
  }
}

function trackingResponse(
  request: CreateOrderRequest,
  context: { storeId: string, orderId: string, orderNumber: string, trackingKeyVersion: number },
  trackingSecrets: Record<string | number, string>,
) {
  const secret = trackingSecrets[String(context.trackingKeyVersion)]
  if (!secret) {
    throw new Error('Tracking key version is unavailable')
  }
  const tracking = createTrackingToken({
    secret,
    keyVersion: context.trackingKeyVersion,
    storeId: context.storeId,
    orderId: context.orderId,
    idempotencyKey: request.idempotencyKey,
  })
  return {
    orderNumber: context.orderNumber,
    trackingPath: `/s/${request.publicSlug}/order/${context.orderNumber}#t=${tracking.token}`,
  }
}

function requireCompletedContext(context: OrderRequestContext) {
  if (!context.orderId || !context.orderNumber || !context.trackingKeyVersion) {
    throw new Error('Incomplete idempotency context')
  }
  return {
    storeId: context.storeId,
    orderId: context.orderId,
    orderNumber: context.orderNumber,
    trackingKeyVersion: context.trackingKeyVersion,
  }
}

const atomicErrors: Record<string, { statusCode: number, message: string }> = {
  STORE_NOT_FOUND: { statusCode: 404, message: 'Không tìm thấy cửa hàng.' },
  IDEMPOTENCY_CONFLICT: { statusCode: 409, message: 'Thông tin đơn hàng đã thay đổi. Vui lòng thử lại.' },
  INVALID_REQUEST: { statusCode: 400, message: 'Thông tin đặt hàng không hợp lệ.' },
  PRODUCT_UNAVAILABLE: { statusCode: 422, message: 'Một món trong giỏ hiện không còn phục vụ.' },
  INVALID_OPTIONS: { statusCode: 422, message: 'Lựa chọn món không còn hợp lệ.' },
  FULFILLMENT_UNAVAILABLE: { statusCode: 422, message: 'Hình thức nhận hàng hiện không khả dụng.' },
  STORE_UNAVAILABLE: { statusCode: 422, message: 'Cửa hàng hiện chưa nhận đơn.' },
  MINIMUM_ORDER_NOT_MET: { statusCode: 422, message: 'Đơn hàng chưa đạt giá trị tối thiểu.' },
}

function mapAtomicError(error: unknown): never {
  const detail = error instanceof Error ? error.message : ''
  const code = Object.keys(atomicErrors).find(candidate => detail.includes(candidate))
  if (!code) throw error
  const mapped = atomicErrors[code]!
  throw new OrderRequestError(mapped.statusCode, code, mapped.message)
}

export function createOrderService(dependencies: CreateOrderDependencies, config: CreateOrderConfig) {
  return {
    async submit(input: unknown, clientIp: string) {
      const parsed = createOrderRequestSchema.safeParse(input)
      if (!parsed.success) {
        throw new OrderRequestError(400, 'INVALID_REQUEST', 'Thông tin đặt hàng không hợp lệ.')
      }
      const request = parsed.data
      const requestHash = sha256Hex(canonicalJson(orderRequestHashInput(request)))
      const rateLimit = await dependencies.consumeRateLimit({
        scope: `orders:${request.publicSlug}`,
        keyHash: sha256Hex(clientIp),
        limit: config.rateLimitMax,
        windowSeconds: config.rateLimitWindowSeconds,
      })
      if (!rateLimit.allowed) {
        throw new OrderRequestError(429, 'RATE_LIMITED', 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.', rateLimit.retryAfter)
      }

      const context = await dependencies.getRequestContext(request.publicSlug, request.idempotencyKey)
      if (!context) {
        throw new OrderRequestError(404, 'STORE_NOT_FOUND', 'Không tìm thấy cửa hàng.')
      }
      if (context.requestHash) {
        if (context.requestHash !== requestHash) {
          throw new OrderRequestError(409, 'IDEMPOTENCY_CONFLICT', 'Thông tin đơn hàng đã thay đổi. Vui lòng thử lại.')
        }
        return trackingResponse(request, requireCompletedContext(context), config.trackingSecrets)
      }

      const turnstilePassed = await dependencies.verifyTurnstile({
        token: request.turnstileToken,
        remoteIp: clientIp,
        idempotencyKey: request.idempotencyKey,
      })
      if (!turnstilePassed) {
        throw new OrderRequestError(422, 'TURNSTILE_REJECTED', 'Không thể xác minh yêu cầu. Vui lòng thử lại.')
      }

      const orderId = dependencies.createOrderId()
      const secret = config.trackingSecrets[String(config.trackingKeyVersion)]
      if (!secret) {
        throw new Error('Current tracking key is unavailable')
      }
      const candidateTracking = createTrackingToken({
        secret,
        keyVersion: config.trackingKeyVersion,
        storeId: context.storeId,
        orderId,
        idempotencyKey: request.idempotencyKey,
      })

      let order: AtomicOrderResult
      try {
        order = await dependencies.createAtomicOrder({
          publicSlug: request.publicSlug,
          orderId,
          idempotencyKey: request.idempotencyKey,
          requestHash,
          trackingTokenHash: candidateTracking.tokenHash,
          trackingKeyVersion: candidateTracking.keyVersion,
          fulfillmentType: request.fulfillmentType,
          customerName: request.customer.name,
          customerPhone: request.customer.phone,
          deliveryAddress: request.delivery?.address ?? null,
          deliveryNote: request.delivery?.note ?? null,
          customerNote: request.customerNote,
          paymentMethod: request.paymentMethod,
          items: request.items,
        })
      }
      catch (error) {
        mapAtomicError(error)
      }

      return trackingResponse(request, order, config.trackingSecrets)
    },
  }
}
