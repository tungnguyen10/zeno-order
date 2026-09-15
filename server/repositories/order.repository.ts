import type {
  AtomicOrderInput,
  AtomicOrderResult,
  OrderRequestContext,
} from '../domain/order/create-order'

interface RpcError {
  message: string
}

interface OrderRpcClient {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid order RPC response')
  }
  return value as Record<string, unknown>
}

export function createOrderRepository(client: OrderRpcClient) {
  return {
    async consumeRateLimit(input: { scope: string, keyHash: string, limit: number, windowSeconds: number }) {
      const { data, error } = await client.rpc('consume_public_rate_limit', {
        p_scope: input.scope,
        p_key_hash: input.keyHash,
        p_limit: input.limit,
        p_window_seconds: input.windowSeconds,
      })
      if (error) throw new Error(error.message)
      const value = record(data)
      return { allowed: value.allowed === true, retryAfter: Number(value.retry_after) }
    },

    async getRequestContext(publicSlug: string, idempotencyKey: string): Promise<OrderRequestContext | null> {
      const { data, error } = await client.rpc('get_order_request_context', {
        p_public_slug: publicSlug,
        p_idempotency_key: idempotencyKey,
      })
      if (error) throw new Error(error.message)
      if (data === null) return null
      const value = record(data)
      return {
        storeId: String(value.store_id),
        requestHash: value.request_hash === null ? null : String(value.request_hash),
        orderId: value.order_id === null ? null : String(value.order_id),
        orderNumber: value.order_number === null ? null : String(value.order_number),
        trackingKeyVersion: value.tracking_key_version === null ? null : Number(value.tracking_key_version),
      }
    },

    async createAtomicOrder(input: AtomicOrderInput): Promise<AtomicOrderResult> {
      const { data, error } = await client.rpc('create_order_atomic', {
        p_public_slug: input.publicSlug,
        p_order_id: input.orderId,
        p_idempotency_key: input.idempotencyKey,
        p_request_hash: input.requestHash,
        p_tracking_token_hash: input.trackingTokenHash,
        p_tracking_key_version: input.trackingKeyVersion,
        p_fulfillment_type: input.fulfillmentType,
        p_customer_name: input.customerName,
        p_customer_phone: input.customerPhone,
        p_delivery_address: input.deliveryAddress,
        p_delivery_note: input.deliveryNote,
        p_customer_note: input.customerNote,
        p_payment_method: input.paymentMethod,
        p_items: input.items,
      })
      if (error) throw new Error(error.message)
      const value = record(data)
      return {
        storeId: String(value.store_id),
        orderId: String(value.order_id),
        orderNumber: String(value.order_number),
        trackingKeyVersion: Number(value.tracking_key_version),
      }
    },
  }
}
