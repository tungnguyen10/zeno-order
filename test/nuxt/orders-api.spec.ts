import type { H3Event } from 'h3'

import { getResponseHeader } from 'h3'
import { describe, expect, it } from 'vitest'

import { createOrdersEventHandler } from '../../server/api/orders.post'
import { OrderRequestError } from '../../server/domain/order/create-order'

function createTestEvent() {
  const headers = new Map<string, string>()
  const event = {
    node: {
      req: {},
      res: {
        statusCode: 200,
        getHeader: (name: string) => headers.get(name.toLowerCase()),
        setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), String(value)),
      },
    },
  } as unknown as H3Event
  return event
}

describe('POST /api/orders', () => {
  it('returns an uncached safe success payload', async () => {
    const event = createTestEvent()
    const handler = createOrdersEventHandler({
      submit: async () => ({ orderNumber: 'A1001', trackingPath: '/s/mochi-cafe/order/A1001#t=token' }),
      readRequest: async () => ({ request: true }),
      getClientIp: () => '192.0.2.10',
    })

    await expect(handler(event)).resolves.toEqual({
      orderNumber: 'A1001',
      trackingPath: '/s/mochi-cafe/order/A1001#t=token',
    })
    expect(getResponseHeader(event, 'cache-control')).toBe('private, no-store')
  })

  it('maps expected errors to a stable envelope and retry header', async () => {
    const event = createTestEvent()
    const handler = createOrdersEventHandler({
      submit: async () => {
        throw new OrderRequestError(429, 'RATE_LIMITED', 'Thử lại sau.', 31)
      },
      readRequest: async () => ({}),
      getClientIp: () => '192.0.2.10',
    })

    await expect(handler(event)).resolves.toEqual({
      error: { code: 'RATE_LIMITED', message: 'Thử lại sau.' },
    })
    expect(event.node.res.statusCode).toBe(429)
    expect(getResponseHeader(event, 'retry-after')).toBe('31')
  })

  it('hides unexpected internal failures', async () => {
    const event = createTestEvent()
    const handler = createOrdersEventHandler({
      submit: async () => { throw new Error('database secret detail') },
      readRequest: async () => ({}),
      getClientIp: () => '192.0.2.10',
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Không thể tạo đơn hàng.',
    })
    expect(getResponseHeader(event, 'cache-control')).toBe('private, no-store')
  })
})
