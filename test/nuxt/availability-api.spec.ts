import type { H3Event } from 'h3'

import { getResponseHeader } from 'h3'
import { describe, expect, it } from 'vitest'

import { createAvailabilityEventHandler } from '../../server/api/storefront/[publicSlug]/availability.get'
import { StoreNotFoundError } from '../../server/domain/store/public-store'

function createTestEvent(publicSlug = 'mochi-cafe') {
  const headers = new Map<string, string>()
  const event = {
    context: { params: { publicSlug } },
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

describe('availability API', () => {
  it('sets no-store before returning success', async () => {
    const event = createTestEvent()
    const handler = createAvailabilityEventHandler({
      resolve: async () => ({ publicSlug: 'mochi-cafe' }),
    })

    await expect(handler(event)).resolves.toEqual({ publicSlug: 'mochi-cafe' })
    expect(getResponseHeader(event, 'cache-control')).toBe('no-store')
  })

  it('returns the safe 404 envelope with no-store', async () => {
    const event = createTestEvent('missing-store')
    const handler = createAvailabilityEventHandler({
      resolve: async () => {
        throw new StoreNotFoundError()
      },
    })

    await expect(handler(event)).resolves.toEqual({
      error: {
        code: 'STORE_NOT_FOUND',
        message: 'Không tìm thấy cửa hàng.',
      },
    })
    expect(event.node.res.statusCode).toBe(404)
    expect(getResponseHeader(event, 'cache-control')).toBe('no-store')
  })

  it('maps internal failures to a safe uncached 500', async () => {
    const event = createTestEvent()
    const handler = createAvailabilityEventHandler({
      resolve: async () => {
        throw new Error('secret timezone or SQL detail')
      },
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Không thể tải tình trạng cửa hàng.',
    })
    expect(getResponseHeader(event, 'cache-control')).toBe('no-store')
  })
})
