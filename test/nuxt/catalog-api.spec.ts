import type { H3Event } from 'h3'

import { getResponseHeader } from 'h3'
import { describe, expect, it } from 'vitest'

import { createCatalogEventHandler } from '../../server/api/storefront/[publicSlug]/catalog.get'
import { StoreNotFoundError } from '../../server/domain/store/public-store'

const cachePolicy = 'public, max-age=0, s-maxage=120, stale-while-revalidate=60'

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

  return { event, headers }
}

describe('catalog API cache and error contract', () => {
  it('caches a successful safe payload and exposes no live/private fields', async () => {
    const { event } = createTestEvent()
    const handler = createCatalogEventHandler({
      resolve: async () => ({
        store: {
          publicSlug: 'mochi-cafe',
          name: 'Mochi Cafe',
          description: null,
          logoPath: null,
          coverPath: null,
          timezone: 'Asia/Ho_Chi_Minh',
          currency: 'VND',
        },
        menus: [],
        sections: [],
        menuItems: [],
        products: [],
        optionGroups: [],
        productOptionGroups: [],
      }),
    })

    const payload = await handler(event)

    expect(getResponseHeader(event, 'cache-control')).toBe(cachePolicy)
    expect(JSON.stringify(payload)).not.toMatch(/storeId|organizationId|isSoldOut|manualOpenState|deliveryEnabled|pickupEnabled/)
  })

  it('caches only the intentional safe 404 envelope', async () => {
    const { event } = createTestEvent('missing-store')
    const handler = createCatalogEventHandler({
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
    expect(getResponseHeader(event, 'cache-control')).toBe(cachePolicy)
  })

  it('never caches or leaks a generic database failure', async () => {
    const { event } = createTestEvent()
    const handler = createCatalogEventHandler({
      resolve: async () => {
        throw new Error('secret SQL detail')
      },
    })

    await expect(handler(event)).rejects.toMatchObject({
      statusCode: 500,
      statusMessage: 'Không thể tải thực đơn.',
    })
    expect(getResponseHeader(event, 'cache-control')).toBe('no-store')
  })
})
