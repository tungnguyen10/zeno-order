import type { H3Event } from 'h3'

import { getResponseHeader } from 'h3'
import { describe, expect, it } from 'vitest'

import { createOrderTrackingEventHandler } from '../../server/api/storefront/[publicSlug]/orders/[orderNumber].get'

function event(publicSlug = 'mochi-cafe', orderNumber = 'A1001', authorization?: string) {
  const headers = new Map<string, string>()
  const target = {
    context: { params: { publicSlug, orderNumber } },
    node: {
      req: { headers: authorization ? { authorization } : {} },
      res: {
        statusCode: 200,
        getHeader: (name: string) => headers.get(name.toLowerCase()),
        setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), String(value)),
      },
    },
  } as unknown as H3Event
  return target
}

describe('order tracking API', () => {
  it('returns a safe private no-store DTO for a bearer token', async () => {
    const target = event('mochi-cafe', 'A1001', `Bearer ${'a'.repeat(43)}`)
    const handler = createOrderTrackingEventHandler({
      resolve: async () => ({ orderNumber: 'A1001', status: 'pending', items: [] }),
    })
    await expect(handler(target)).resolves.toMatchObject({ orderNumber: 'A1001' })
    expect(getResponseHeader(target, 'cache-control')).toBe('private, no-store')
  })

  it.each([undefined, 'Bearer bad-token'])('uses the same 404 for missing or invalid credentials', async (authorization) => {
    const target = event('mochi-cafe', 'A1001', authorization)
    const handler = createOrderTrackingEventHandler({ resolve: async () => null })
    await expect(handler(target)).resolves.toEqual({
      error: { code: 'ORDER_NOT_FOUND', message: 'Không tìm thấy đơn hàng.' },
    })
    expect(target.node.res.statusCode).toBe(404)
  })
})
