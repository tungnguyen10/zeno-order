import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { fetch, setup } from '@nuxt/test-utils/e2e'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, getDb } from '../../server/db/client'
import { orders, products } from '../../server/db/schema'
import { breadItem, deliveryBody, openStore, pickupBody, seedMenu, teaItem, type SeededMenu } from '../support/checkout-fixtures'
import { resetDb } from '../support/db'
import { createTenant } from '../support/fixtures'
import { findForbiddenKeys } from '../support/json'

// This suite simulates an ingress that overwrites XFF to test distinct client IPs.
// The production hardening suite separately proves untrusted XFF cannot bypass limits.
process.env.TRUST_FORWARDED_FOR = '1'

await setup({
  rootDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: true,
  build: true,
  nuxtConfig: { typescript: { typeCheck: false } },
})

let ipSeq = 0
const nextIp = () => `198.51.100.${(ipSeq += 1)}`

async function http(method: 'GET' | 'POST', path: string, body?: unknown, ip = nextIp()) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => null) }
}

const post = (slug: string, body: unknown, ip?: string) => http('POST', `/api/public/stores/${slug}/orders`, body, ip)
const track = (token: string) => http('GET', `/api/public/orders/${token}`)

let tenant: Awaited<ReturnType<typeof createTenant>>
let menu: SeededMenu

beforeAll(async () => {
  await resetDb()
  tenant = await createTenant('a')
  await openStore(tenant.store.id, { deliveryEnabled: true })
  menu = await seedMenu(tenant.store)
})

afterAll(async () => {
  await closeDb()
})

describe('POST /api/public/stores/:slug/orders', () => {
  it('creates an order: 201, no-store, only the documented keys', async () => {
    const res = await post(tenant.store.slug, pickupBody(menu))
    expect(res.status).toBe(201)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(Object.keys(res.body).sort()).toEqual(['guestToken', 'paymentStatus', 'publicCode', 'status', 'totalVnd'])
    expect(res.body).toMatchObject({ status: 'NEW', paymentStatus: 'UNPAID', totalVnd: 70_000 })
    expect(findForbiddenKeys(res.body)).toEqual([])
  })

  it('retrying the same key returns 200 with the same order and token (Review Focus #8)', async () => {
    const body = pickupBody(menu)
    const first = await post(tenant.store.slug, body)
    const retry = await post(tenant.store.slug, body)
    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.body).toEqual(first.body)
    const [{ n }] = await getDb().select({ n: count() }).from(orders).where(eq(orders.publicCode, first.body.publicCode))
    expect(n).toBe(1)
  })

  it.each([
    ['+84 912 345 678', 201],
    ['0912.345.678', 201],
    ['0212345678', 400],
    ['091234', 400],
  ])('phone %j → %i', async (phone, status) => {
    const res = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Lan', phone } }))
    expect(res.status).toBe(status)
    if (status === 400) {
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', details: [{ path: 'customer.phone', message: 'Số điện thoại không hợp lệ' }] })
    }
  })

  it('answers whitespace-only names with an inline error on the name field', async () => {
    const res = await post(tenant.store.slug, pickupBody(menu, { customer: { name: '   ', phone: '0912345678' } }))
    expect(res).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED', details: [{ path: 'customer.name' }] } })
  })

  it('rejects malformed JSON with 400 and an unknown store with 404', async () => {
    expect(await post(tenant.store.slug, '{"items":')).toMatchObject({ status: 400, body: { code: 'VALIDATION_FAILED' } })
    expect(await post('khong-co-quan', pickupBody(menu))).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
  })

  it('409 CART_STALE names the line and carries the new price when the owner changed it', async () => {
    await getDb().update(products).set({ basePriceVnd: 39_000 }).where(eq(products.id, menu.bread.id))
    const res = await post(tenant.store.slug, pickupBody(menu, { items: [breadItem(menu)], expectedTotalVnd: 20_000 }))
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'CART_STALE',
      details: { lines: [{ index: 0, productId: menu.bread.id, reason: 'PRICE_CHANGED', currentUnitPriceVnd: 39_000 }], totalVnd: null },
    })
    await getDb().update(products).set({ basePriceVnd: 20_000 }).where(eq(products.id, menu.bread.id))
  })

  it('422 STORE_CLOSED for a store that is not accepting orders', async () => {
    const closed = await createTenant('closed')
    const closedMenu = await seedMenu(closed.store)
    expect(await post(closed.store.slug, pickupBody(closedMenu))).toMatchObject({ status: 422, body: { code: 'STORE_CLOSED' } })
  })

  it('429 RATE_LIMITED on the 11th new order from one ip, while other ips still work', async () => {
    const limited = await createTenant('limited')
    await openStore(limited.store.id)
    const limitedMenu = await seedMenu(limited.store)
    for (let i = 0; i < 10; i++) expect((await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.77')).status).toBe(201)
    expect(await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.77')).toMatchObject({ status: 429, body: { code: 'RATE_LIMITED' } })
    expect((await post(limited.store.slug, pickupBody(limitedMenu), '192.0.2.78')).status).toBe(201)
  })
})

describe('GET /api/public/orders/:token', () => {
  it('returns the tracking view with no-store/noindex and no PII (Review Focus #3)', async () => {
    const created = await post(tenant.store.slug, deliveryBody(menu))
    const res = await track(created.body.guestToken)

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-robots-tag')).toBe('noindex')
    expect(res.body).toMatchObject({
      publicCode: created.body.publicCode,
      status: 'NEW',
      fulfillmentType: 'DELIVERY',
      deliveryZoneName: 'Quận 1',
      customerName: 'Lan',
      phoneMasked: '*******678',
      totalVnd: 85_000,
      store: { name: tenant.store.name, slug: tenant.store.slug },
      qr: null,
    })

    expect(findForbiddenKeys(res.body)).toEqual([])
    const raw = JSON.stringify(res.body)
    for (const secret of ['0912345678', '12 Lê Lợi', tenant.org.id, tenant.store.id, 'guestToken', 'idempotency']) expect(raw).not.toContain(secret)
  })

  it('returns text exactly as typed, so the page can render it escaped', async () => {
    const note = '<img src=x onerror="window.__xss=1">'
    const created = await post(tenant.store.slug, pickupBody(menu, { items: [teaItem(menu, { note })] }))
    const res = await track(created.body.guestToken)
    expect(res.body.items[0].note).toBe(note)
  })

  it('answers a wrong token exactly like a random one (404, same body), with no-store', async () => {
    const created = await post(tenant.store.slug, pickupBody(menu))
    const random = await track(randomBytes(32).toString('base64url'))
    const lowered = await track(created.body.guestToken.toUpperCase())
    const malformed = await track('abc')
    expect(random).toMatchObject({ status: 404, body: { code: 'NOT_FOUND' } })
    expect(random.headers.get('cache-control')).toBe('no-store')
    expect(lowered.status).toBe(404)
    expect(lowered.body).toEqual(random.body)
    expect(malformed.body).toEqual(random.body)
  })

  it('never confuses two orders', async () => {
    const a = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Ân', phone: '0911111111' } }))
    const b = await post(tenant.store.slug, pickupBody(menu, { customer: { name: 'Bình', phone: '0922222222' } }))
    expect((await track(a.body.guestToken)).body).toMatchObject({ customerName: 'Ân', phoneMasked: '*******111' })
    expect((await track(b.body.guestToken)).body).toMatchObject({ customerName: 'Bình', phoneMasked: '*******222' })
  })
})
