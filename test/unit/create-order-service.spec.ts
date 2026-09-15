import { describe, expect, it, vi } from 'vitest'

import type { OrderRequestError } from '../../server/domain/order/create-order'
import { createOrderService } from '../../server/domain/order/create-order'

const request = {
  publicSlug: 'mochi-cafe',
  fulfillmentType: 'pickup' as const,
  customer: { name: '  Tú  ', phone: ' 0900000000 ' },
  delivery: null,
  customerNote: '  Ít đá  ',
  paymentMethod: 'cash' as const,
  items: [{
    productId: '63000000-0000-0000-0000-000000000001',
    quantity: 2,
    optionValueIds: [
      '93000000-0000-0000-0000-000000000002',
      '93000000-0000-0000-0000-000000000001',
    ],
    note: '  không ống hút  ',
  }],
  idempotencyKey: 'd1000000-0000-4000-8000-000000000001',
  turnstileToken: 'turnstile-token',
}

function createDependencies() {
  const calls: string[] = []
  return {
    calls,
    dependencies: {
      consumeRateLimit: vi.fn(async () => {
        calls.push('rate-limit')
        return { allowed: true, retryAfter: 0 }
      }),
      getRequestContext: vi.fn(async () => {
        calls.push('context')
        return {
          storeId: '23000000-0000-0000-0000-000000000001',
          requestHash: null,
          orderId: null,
          orderNumber: null,
          trackingKeyVersion: null,
        }
      }),
      verifyTurnstile: vi.fn(async () => {
        calls.push('turnstile')
        return true
      }),
      createAtomicOrder: vi.fn(async () => {
        calls.push('atomic')
        return {
          storeId: '23000000-0000-0000-0000-000000000001',
          orderId: 'c1000000-0000-4000-8000-000000000001',
          orderNumber: 'A1001',
          trackingKeyVersion: 1,
        }
      }),
      createOrderId: () => 'c1000000-0000-4000-8000-000000000001',
    },
  }
}

const config = {
  rateLimitMax: 8,
  rateLimitWindowSeconds: 60,
  trackingKeyVersion: 1,
  trackingSecrets: { 1: 'tracking-secret-that-is-at-least-32-bytes' },
}

describe('createOrderService', () => {
  it('normalizes, hashes, verifies and writes in the required order', async () => {
    const { calls, dependencies } = createDependencies()
    const service = createOrderService(dependencies, config)

    const result = await service.submit(request, '192.0.2.10')

    expect(calls).toEqual(['rate-limit', 'context', 'turnstile', 'atomic'])
    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'orders:mochi-cafe',
      keyHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(dependencies.createAtomicOrder).toHaveBeenCalledWith(expect.objectContaining({
      customerName: 'Tú',
      customerPhone: '0900000000',
      customerNote: 'Ít đá',
      items: [{
        productId: request.items[0]!.productId,
        quantity: 2,
        optionValueIds: [...request.items[0]!.optionValueIds].sort(),
        note: 'không ống hút',
      }],
      requestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      trackingTokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(result).toEqual({
      orderNumber: 'A1001',
      trackingPath: expect.stringMatching(/^\/s\/mochi-cafe\/order\/A1001#t=[A-Za-z0-9_-]{43}$/),
    })
  })

  it('returns a completed equal retry without consuming Turnstile again', async () => {
    const { dependencies } = createDependencies()
    const firstService = createOrderService(dependencies, config)
    await firstService.submit(request, '192.0.2.10')
    const hash = dependencies.createAtomicOrder.mock.calls[0]![0].requestHash

    dependencies.getRequestContext.mockResolvedValue({
      storeId: '23000000-0000-0000-0000-000000000001',
      requestHash: hash,
      orderId: 'c1000000-0000-4000-8000-000000000001',
      orderNumber: 'A1001',
      trackingKeyVersion: 1,
    })
    dependencies.verifyTurnstile.mockClear()
    dependencies.createAtomicOrder.mockClear()

    const retry = await createOrderService(dependencies, config).submit(request, '192.0.2.10')

    expect(retry.orderNumber).toBe('A1001')
    expect(dependencies.verifyTurnstile).not.toHaveBeenCalled()
    expect(dependencies.createAtomicOrder).not.toHaveBeenCalled()
  })

  it('rejects a changed payload under an existing key before Turnstile', async () => {
    const { dependencies } = createDependencies()
    dependencies.getRequestContext.mockResolvedValue({
      storeId: '23000000-0000-0000-0000-000000000001',
      requestHash: 'f'.repeat(64),
      orderId: 'c1000000-0000-4000-8000-000000000001',
      orderNumber: 'A1001',
      trackingKeyVersion: 1,
    })

    await expect(createOrderService(dependencies, config).submit(request, '192.0.2.10'))
      .rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_CONFLICT' })
    expect(dependencies.verifyTurnstile).not.toHaveBeenCalled()
  })

  it('rejects unknown fields such as client-supplied prices', async () => {
    const { dependencies } = createDependencies()
    await expect(createOrderService(dependencies, config).submit({
      ...request,
      items: [{ ...request.items[0], unitPrice: '1' }],
    }, '192.0.2.10')).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_REQUEST' })
    expect(dependencies.consumeRateLimit).not.toHaveBeenCalled()
  })

  it('maps rate limit and Turnstile failures to safe domain errors', async () => {
    const rateLimited = createDependencies()
    rateLimited.dependencies.consumeRateLimit.mockResolvedValue({ allowed: false, retryAfter: 37 })
    await expect(createOrderService(rateLimited.dependencies, config).submit(request, '192.0.2.10'))
      .rejects.toEqual(expect.objectContaining<Partial<OrderRequestError>>({
        statusCode: 429,
        code: 'RATE_LIMITED',
        retryAfter: 37,
      }))

    const bot = createDependencies()
    bot.dependencies.verifyTurnstile.mockResolvedValue(false)
    await expect(createOrderService(bot.dependencies, config).submit(request, '192.0.2.10'))
      .rejects.toMatchObject({ statusCode: 422, code: 'TURNSTILE_REJECTED' })
  })

  it.each([
    ['PRODUCT_UNAVAILABLE', 422],
    ['INVALID_OPTIONS', 422],
    ['STORE_UNAVAILABLE', 422],
    ['MINIMUM_ORDER_NOT_MET', 422],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['STORE_NOT_FOUND', 404],
  ])('maps atomic database error %s without leaking SQL details', async (databaseCode, statusCode) => {
    const { dependencies } = createDependencies()
    dependencies.createAtomicOrder.mockRejectedValue(new Error(`${databaseCode}: private SQL context`))

    await expect(createOrderService(dependencies, config).submit(request, '192.0.2.10'))
      .rejects.toMatchObject({ statusCode, code: databaseCode })
  })
})
